// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  TopodManagedStopDecisionSchema,
  TopodManagedStopRequestSchema,
  type TopodManagedStopDecision,
  type TopodManagedStopRequest
} from '../../shared/topod-stop-request'
import { topodStopReceiptPath, readTopodStopReceipt } from './topod-completed-stop-receipt'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'

type TopodManagedStopDecisionValue = TopodManagedStopDecision['decision']

export function readTopodManagedStopDecision(
  request: TopodManagedStopRequest
): TopodManagedStopDecisionValue | null {
  return readTopodStopReceipt(request, 'decision', TopodManagedStopDecisionSchema)?.decision ?? null
}

export function claimTopodManagedStopDecision(
  input: TopodManagedStopRequest,
  decision: TopodManagedStopDecisionValue
): TopodManagedStopDecisionValue {
  const request = TopodManagedStopRequestSchema.parse(input)
  const path = topodStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: TopodManagedStopDecision = {
    schemaVersion: 1,
    kind: 'topod_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('topod_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readTopodManagedStopDecision(request)
    if (!standing) {
      throw new Error('topod_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
