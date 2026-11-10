import { TopodWindowsLaunchFailedError } from '../install/topod-remote-launch-windows'
import { TopodLaunchReadinessError } from './topod-active-readiness'

/** A launch that ended a run: it never became ready, or the host reported it could not start. */
export function isTopodLaunchFailure(error: unknown): error is Error {
  return (
    error instanceof TopodLaunchReadinessError || error instanceof TopodWindowsLaunchFailedError
  )
}

/** Only a readiness failure had a running topod, whose death the next topod will report. */
export function topodLaunchFailureRanProcess(error: Error): boolean {
  return error instanceof TopodLaunchReadinessError
}
