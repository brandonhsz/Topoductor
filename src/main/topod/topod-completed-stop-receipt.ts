import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'
import {
  TOPOD_STOP_RECEIPTS_DIRNAME,
  TopodCompletedStopReceiptSchema,
  TopodManagedStopRequestSchema,
  TopodDaemonRetirementRecordSchema,
  topodManagedStopRequestKey,
  type TopodCompletedStopReceipt,
  type TopodDaemonRetirementRecord,
  type TopodManagedStopRequest
} from '../../shared/topod-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function topodStopReceiptPath(request: TopodManagedStopRequest, kind: ReceiptKind): string {
  const { transactionId, instance } = TopodManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    TOPOD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readTopodStopReceipt<T extends { request: TopodManagedStopRequest }>(
  request: TopodManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = topodStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('topod_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (topodManagedStopRequestKey(receipt.request) !== topodManagedStopRequestKey(request)) {
    throw new Error('topod_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(request: TopodManagedStopRequest, kind: ReceiptKind, receipt: unknown): void {
  if (!writeDurableSecureJsonFile(topodStopReceiptPath(request, kind), receipt)) {
    throw new Error('topod_stop_receipt_permissions_unconfirmed')
  }
}

export function readTopodCompletedStopReceipt(
  request: TopodManagedStopRequest
): TopodCompletedStopReceipt | null {
  return readTopodStopReceipt(request, 'completed', TopodCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistTopodCompletedStopReceipt(
  request: TopodManagedStopRequest,
  exitedAt: Date
): TopodCompletedStopReceipt {
  const parsed = TopodManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readTopodDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readTopodCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'topod_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readTopodDaemonRetirementRecord(
  request: TopodManagedStopRequest
): TopodDaemonRetirementRecord | null {
  return readTopodStopReceipt(request, 'retirement', TopodDaemonRetirementRecordSchema)
}

export function persistTopodDaemonRetirementRecord(
  request: TopodManagedStopRequest,
  outcome: Pick<TopodDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'topod_managed_stop_retirement',
    request: TopodManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
