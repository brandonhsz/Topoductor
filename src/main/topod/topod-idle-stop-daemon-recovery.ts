// Cancelled idle stops may leave daemon admission closed. Replace only after atomic retirement
// agreement: replacement could otherwise kill the old daemon’s live sessions.
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { TopodDaemonRetirement } from './topod-daemon-retirement'
import { TOPOD_DAEMON_RETIREMENT_TIMEOUT_MS } from './topod-stop-deadlines'

type RetirementOutcome = Pick<TopodDaemonRetirement, 'retirement' | 'lateRetirement'>

type TopodIdleStopDaemonRecoveryPorts = {
  admissionClosed: () => boolean
  /** Atomically recheck census and retirement fence in the daemon. */
  retireAgain: () => Promise<RetirementOutcome>
  replaceDaemon: () => Promise<unknown>
  timeoutMs?: number
}

export async function recoverDaemonAfterCancelledIdleStop(
  outcome: RetirementOutcome,
  ports: TopodIdleStopDaemonRecoveryPorts
): Promise<'serving' | 'unservable'> {
  const timeoutMs = ports.timeoutMs ?? TOPOD_DAEMON_RETIREMENT_TIMEOUT_MS
  const retired = async (candidate: RetirementOutcome): Promise<boolean> =>
    candidate.retirement === 'retired' ||
    (candidate.lateRetirement !== undefined &&
      (await withTimeout(candidate.lateRetirement, timeoutMs, false)))
  if (!(await retired(outcome))) {
    if (!ports.admissionClosed()) {
      return 'serving'
    }
    // Only the daemon can resolve a lost retirement reply.
    const retry = await ports
      .retireAgain()
      .catch((): RetirementOutcome => ({ retirement: 'unverifiable' }))
    if (!(await retired(retry))) {
      if (ports.admissionClosed()) {
        console.error('[topod] the terminal daemon may be retiring and did not settle it')
        return 'unservable'
      }
      return 'serving'
    }
  }
  try {
    await ports.replaceDaemon()
    console.error('[topod] a client returned during idle stop; started a fresh terminal daemon')
    return 'serving'
  } catch (error) {
    console.error('[topod] could not replace the retired terminal daemon:', error)
    return 'unservable'
  }
}
