import { topodRemoteBaseDir } from '../install/topod-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { TopodRollbackOptions, TopodRollbackResult } from '../install/topod-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/topod-activation-record'
import { writeTopodActivationRecord } from '../activation/topod-activation-record-store'
import { launchAndJudgeTopodSlot } from '../activation/topod-candidate-launch-verdict'
import { assessTopodRollback } from './topod-rollback-safety'
import { TOPOD_LOG_FILENAME } from '../install/topod-remote-host-support'
import {
  captureTopodStateSnapshotCommand,
  topodRollbackRescueDirName,
  parseTopodSnapshotCapture,
  parseTopodSnapshotPresence,
  parseTopodSnapshotRestore,
  probeTopodStateSnapshotCommand,
  restoreTopodStateSnapshotCommand
} from '../host-state/topod-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/topod-state-newest-mtime'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import type { TopodActivationLockControl } from '../activation/topod-activation-lock'
import {
  rollbackStartingState,
  type TopodRollbackTransaction
} from '../activation/topod-activation-transaction'
import {
  createTopodRollbackTransaction,
  withTopodRollbackPhase,
  withTopodRollbackRescue
} from '../activation/topod-activation-transaction-transitions'
import { writeTopodActivationTransaction } from '../activation/topod-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './topod-rollback-admission'
import { runFencedStop } from '../activation/topod-fenced-stop'
import { execTopodRemoteOr, withoutAbortSignal } from '../install/topod-remote-runtime-control'
import { execTopodStateMutationOr } from '../host-state/topod-state-mutation-exec'
import {
  topodSlotDir,
  resolveTopodSlotIdentity,
  type TopodSlotIdentity
} from '../activation/topod-recovery-slot'
import { topodSnapshotPath } from '../activation/topod-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../activation/topod-transaction-incumbent'
import {
  readTopodRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './topod-rollback-terminal-barrier'
import { withTopodLogTail } from '../install/topod-remote-log-tail'
import { errorMessage } from '../../../shared/error-message'

async function stateWritesSinceActivation(options: TopodRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execTopodRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        topodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackTopodLocked(
  options: TopodRollbackOptions,
  lock: TopodActivationLockControl
): Promise<TopodRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseTopodSnapshotPresence(
        await execTopodRemoteOr(
          options,
          probeTopodStateSnapshotCommand(
            options.host,
            topodSnapshotPath(options, snapshot.dirName),
            topodRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessTopodRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'topod_rollback_no_active',
      reason: 'No topod version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: TopodSlotIdentity
  try {
    incumbent = await resolveTopodSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'topod_rollback_active_identity_unverifiable',
      reason: `The active topod identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readTopodRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: TopodRollbackTransaction = createTopodRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: topodRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeTopodActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withTopodRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeTopodActivationTransaction(options, transaction)

  const rescue = parseTopodSnapshotCapture(
    await execTopodStateMutationOr(
      options,
      captureTopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        topodSnapshotPath(options, transaction.rescue.dirName),
        topodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'topod_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withTopodRollbackRescue(transaction, rescue, now())
  await writeTopodActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseTopodSnapshotRestore(
    await execTopodStateMutationOr(
      options,
      restoreTopodStateSnapshotCommand(
        options.host,
        options.userDataDir,
        topodSnapshotPath(options, snapshot.dirName),
        topodRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'topod_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withTopodRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeTopodActivationTransaction(options, transaction)

  const targetDir = topodSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeTopodSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'topod_rollback_target_launch_failed',
      reason: await withTopodLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, TOPOD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withTopodRollbackPhase(transaction, 'target-ready', now())
  await writeTopodActivationTransaction(options, transaction)
  await writeTopodActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: TopodRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: TopodRollbackOptions,
  lock: TopodActivationLockControl,
  transaction: TopodRollbackTransaction,
  incumbent: TopodSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `topod ${incumbent.version} was restored and is serving again.`
}
