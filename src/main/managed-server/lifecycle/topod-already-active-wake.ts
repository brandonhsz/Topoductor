import { TopodCrashLoopError, wakeManagedTopodUnlessCrashLooping } from './topod-managed-crash-loop'
import { wakeStoppedManagedTopod } from './topod-managed-wake'
import type { TopodSlotOptions } from '../activation/topod-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveTopod(
  options: TopodSlotOptions,
  /** SSH-managed hosts share the crash-loop brake with every other automatic wake. */
  managed?: { environmentId: string; hostLabel: string }
): Promise<boolean> {
  const wake = managed
    ? await wakeManagedTopodUnlessCrashLooping(managed.environmentId, managed.hostLabel, options)
    : await wakeStoppedManagedTopod(options)
  if (wake.outcome === 'crash-loop') {
    throw new TopodCrashLoopError(wake.detail)
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
