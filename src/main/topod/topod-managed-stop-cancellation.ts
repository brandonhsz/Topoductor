import { rmSync } from 'node:fs'
import type {
  TopodManagedStopCancellation,
  TopodManagedStopRequest
} from '../../shared/topod-stop-request'
import { claimTopodManagedStopDecision } from './topod-managed-stop-decision'
import {
  topodManagedStopRequestPath,
  readTopodManagedStopRequest
} from './topod-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelTopodManagedStop(
  request: TopodManagedStopRequest
): TopodManagedStopCancellation['outcome'] {
  const outcome = claimTopodManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawTopodManagedStopRequest(request)
  }
  return outcome
}

export function withdrawTopodManagedStopRequest(request: TopodManagedStopRequest): void {
  const path = topodManagedStopRequestPath(request.instance)
  try {
    if (readTopodManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
