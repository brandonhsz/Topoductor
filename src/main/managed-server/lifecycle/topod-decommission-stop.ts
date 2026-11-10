// Lost stop answers are unverifiable; only confirmed exit or cancellation releases the fence.
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  cancelRemoteTopodManagedStop,
  completeRemoteTopodManagedStop
} from './topod-managed-remote-stop'
import type { TopodSlotOptions } from '../activation/topod-recovery-slot'
import type {
  TopodDaemonRetirementVerdict,
  TopodManagedStopRequest
} from '../../../shared/topod-stop-request'
import { errorMessage } from '../../../shared/error-message'

type TopodDecommissionStopSettlement =
  | { state: 'exited'; retirement: TopodDaemonRetirementVerdict }
  /** Confirmed cancellation leaves the incumbent serving. */
  | { state: 'withdrawn'; verdict: 'live' | 'unverifiable'; reason: string }
  /** Stop underway or unconfirmed; retain the fence. */
  | { state: 'unsettled'; verdict: 'live' | 'unverifiable'; reason: string }

export async function settleTopodDecommissionStop(
  options: TopodSlotOptions,
  request: TopodManagedStopRequest
): Promise<TopodDecommissionStopSettlement> {
  let verdict: 'live' | 'unverifiable'
  let reason: string
  try {
    const completion = await completeRemoteTopodManagedStop(options, request)
    if (completion.verdict === 'exited') {
      // A completion without a recorded outcome proves exit but not retirement.
      return { state: 'exited', retirement: completion.retirement ?? 'unverifiable' }
    }
    verdict = completion.verdict
    reason = `topod ${request.version} did not exit (${completion.verdict}).`
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    verdict = 'unverifiable'
    reason = `The host gave no verifiable stop verdict: ${errorMessage(error)}`
  }
  try {
    const cancellation = await cancelRemoteTopodManagedStop(options, request)
    if (cancellation.outcome === 'canceled') {
      return {
        state: 'withdrawn',
        verdict,
        reason: `${reason} The stop request was withdrawn; topod keeps serving.`
      }
    }
    return {
      state: 'unsettled',
      verdict: 'live',
      reason: `${reason} topod already acted on the request and is still stopping.`
    }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      state: 'unsettled',
      verdict: 'unverifiable',
      reason: `${reason} Withdrawing the request gave no verifiable answer: ${errorMessage(error)}`
    }
  }
}
