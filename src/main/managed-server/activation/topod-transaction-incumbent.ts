import type { TopodActivationLockControl } from './topod-activation-lock'
import type { TopodSnapshotVerdict } from './topod-activation-transaction'
import { topodStopFreedTheHost } from '../install/topod-remote-process-control'
import { withoutAbortSignal } from '../install/topod-remote-runtime-control'
import {
  launchTopodSlot,
  stopTopodSlot,
  TOPOD_SLOT_STOP_WAIT_SECONDS,
  type TopodSlotIdentity,
  type TopodSlotOptions
} from './topod-recovery-slot'
import { recoverTopodIncumbent } from './topod-incumbent-recovery'
import { errorMessage } from '../../../shared/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: TopodSlotOptions,
  incumbent: TopodSlotIdentity,
  lock: TopodActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopTopodSlot(options, incumbent.remoteDir, false)
  if (topodStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that topod ${incumbent.version} exited within ` +
      `${TOPOD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: TopodSlotOptions,
  incumbent: TopodSlotIdentity,
  lock: TopodActivationLockControl
): Promise<string> {
  try {
    await launchTopodSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `topod ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting topod ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: TopodSlotOptions,
  lock: TopodActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: TopodSlotIdentity | null
    restoreState: TopodSnapshotVerdict | null
    launchedFromState?: TopodSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverTopodIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: TopodSlotOptions,
  lock: TopodActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: TopodSlotIdentity | null
    restoreState: TopodSnapshotVerdict | null
    launchedFromState?: TopodSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopTopodSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `topod ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `topod ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
