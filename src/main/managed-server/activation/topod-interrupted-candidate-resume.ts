/** Resume through the original readiness gate before undoing: the candidate may already serve changed state, and stopping it could require operator consent before anything can serve again. */
import type { ServeReadiness } from '../../server/serve-readiness'
import { withActivatedVersion } from './topod-activation-record'
import { writeTopodActivationRecord } from './topod-activation-record-store'
import type { TopodActivateTransaction } from './topod-activation-transaction'
import { writeTopodActivationTransaction } from './topod-activation-transaction-store'
import { withTopodActivationCandidateReady } from './topod-activation-transaction-transitions'
import { TopodActiveReadinessError } from './topod-active-readiness'
import { topodLivenessProvenExited } from '../install/topod-remote-launch'
import {
  TOPOD_RECOVERY_CHANGED_STATE_CODE,
  type TopodManagedRefusal
} from '../../../shared/topod-managed-runtime'
import {
  ensureTopodSlotServing,
  topodSlotDir,
  resolveTopodSlotIdentity,
  slotLiveness
} from './topod-recovery-slot'
import type { TopodIncumbentRecoveryOptions } from './topod-incumbent-recovery'
import { isTopodLaunchFailure } from './topod-launch-failure'

/** Under the held fence, return null (or the candidate's launch failure) for undo; a refusal leaves the host untouched for an operator. */
export async function resumeInterruptedTopodCandidate(
  options: TopodIncumbentRecoveryOptions,
  transaction: TopodActivateTransaction
): Promise<ServeReadiness | TopodManagedRefusal | { launchFailure: Error } | null> {
  const snapshotState = transaction.snapshot.state
  const incumbent = transaction.recordBefore.active
  if (
    transaction.phase !== 'snapshot-captured' ||
    snapshotState === 'pending' ||
    // A serving incumbent holds the port and instance lock; undo keeps it.
    (incumbent !== null &&
      !topodLivenessProvenExited(await slotLiveness(options, topodSlotDir(options, incumbent))))
  ) {
    return null
  }
  const candidate = await resolveTopodSlotIdentity(options, transaction.candidateVersion)
  const candidateLiveness = await slotLiveness(options, candidate.remoteDir)
  // Old journals lack candidate app version, so commit would drop downgrade protection; undo a possibly serving candidate only with consent.
  if (transaction.candidateAppVersion === undefined) {
    if (topodLivenessProvenExited(candidateLiveness) || options.acceptChangedState) {
      return null
    }
    if (candidateLiveness === 'UNKNOWN') {
      throw new Error(`Could not tell whether topod ${transaction.candidateVersion} is running.`)
    }
    return {
      outcome: 'refused',
      verdict: 'live',
      code: TOPOD_RECOVERY_CHANGED_STATE_CODE,
      reason:
        `An older Topo left version ${transaction.candidateVersion} running without finishing ` +
        'its update, and did not record which app started it, so it was neither committed nor ' +
        'stopped. Recover to stop it, restore the prelaunch snapshot and restart the previous ' +
        'build; what it changed is discarded.'
    }
  }
  // Undo must rule out an unprovable candidate before starting another slot.
  if (candidateLiveness === 'UNKNOWN') {
    return null
  }
  let readiness: ServeReadiness
  try {
    readiness = await ensureTopodSlotServing(options, candidate)
  } catch (error) {
    // Only candidate evidence permits undo; unanswered hosts retain the fence.
    if (error instanceof TopodActiveReadinessError && error.verdict !== 'unverifiable') {
      // Undo still follows; the failed candidate launch is a failed run all the same.
      return isTopodLaunchFailure(error) ? { launchFailure: error } : null
    }
    throw error
  }
  const now = new Date()
  const recordAfter = withActivatedVersion(
    transaction.recordBefore,
    transaction.candidateVersion,
    snapshotState === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: transaction.candidateVersion,
          readableByVersion: incumbent,
          takenAt: transaction.startedAt
        }
      : null,
    now,
    transaction.candidateAppVersion ?? undefined
  )
  await writeTopodActivationTransaction(
    options,
    withTopodActivationCandidateReady(transaction, recordAfter, now)
  )
  await writeTopodActivationRecord(options, recordAfter)
  return readiness
}
