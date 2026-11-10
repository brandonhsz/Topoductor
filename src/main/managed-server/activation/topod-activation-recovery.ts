// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planTopodTransactionRecovery,
  type TopodActivationTransaction
} from './topod-activation-transaction'
import { readTopodActivationTransaction } from './topod-activation-transaction-store'
import {
  readTopodActivationRecord,
  writeTopodActivationRecord
} from './topod-activation-record-store'
import {
  topodActivationFenceExists,
  withStaleTopodActivationRecoveryLock
} from './topod-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureTopodSlotServing, resolveTopodSlotIdentity } from './topod-recovery-slot'
import { reconcileTopodDecommission } from '../lifecycle/topod-decommission-recovery'
import {
  recoverTopodIncumbent,
  type TopodIncumbentRecoveryOptions
} from './topod-incumbent-recovery'
import type { TopodManagedRefusal } from '../../../shared/topod-managed-runtime'
import { resumeInterruptedTopodCandidate } from './topod-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/error-message'
import { isTopodLaunchFailure } from './topod-launch-failure'

export type TopodActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  /** A launch failure behind an unverifiable refusal still ended a run. */
  | (TopodManagedRefusal & { launchFailure?: Error })

type TopodActivationRecoveryOptions = TopodIncumbentRecoveryOptions

export const TOPOD_RECOVERY_UNVERIFIABLE_CODE = 'topod_recovery_unverifiable'

/** Both pre-fence answers, read moments ago on this connect; they only skip the same two reads. */
export type TopodActivationIdlePreRead = { transactionAbsent: boolean; fenceOpen: boolean }

export async function recoverInterruptedTopodActivation(
  options: TopodActivationRecoveryOptions,
  preRead?: TopodActivationIdlePreRead
): Promise<TopodActivationRecoveryResult> {
  if (preRead?.transactionAbsent && preRead.fenceOpen) {
    return { outcome: 'none' }
  }
  try {
    if (
      !(await readTopodActivationTransaction(options)) &&
      !(await topodActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleTopodActivationRecoveryLock(options, async (lock) => {
      const transaction = await readTopodActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileTopodTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'topod_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: TOPOD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.',
      ...(isTopodLaunchFailure(error) ? { launchFailure: error } : {})
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileTopodTransaction(
  options: TopodActivationRecoveryOptions,
  transaction: TopodActivationTransaction
): Promise<TopodActivationRecoveryResult> {
  const plan = planTopodTransactionRecovery(transaction, await readTopodActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileTopodDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeTopodActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveTopodSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureTopodSlotServing(options, identity)
    }
  }
  let launchFailure: Error | undefined
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedTopodCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness && 'launchFailure' in readiness) {
      launchFailure = readiness.launchFailure
    } else if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverTopodIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveTopodSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? { ...recovery, ...(launchFailure ? { launchFailure } : {}) }
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
