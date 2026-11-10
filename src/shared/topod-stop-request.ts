/** Stop files reach only the watching topod; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from './zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const TOPOD_STOP_REQUEST_FILENAME = '.topod-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const TOPOD_MANAGED_STOP_REQUEST_PREFIX = '.topod-managed-stop-request'
export const TOPOD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const TOPOD_STOP_RECEIPTS_DIRNAME = 'topod-stop-receipts'
export const TOPOD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const TOPOD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One topod process: its PID, start time, and the instance lock record it published. */
export const TopodManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const TopodManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: TopodManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type TopodManagedStopInstance = z.infer<typeof TopodManagedStopInstanceSchema>
export type TopodManagedStopRequest = z.infer<typeof TopodManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function topodManagedStopRequestKey(request: TopodManagedStopRequest): string {
  const { instance, ...rest } = TopodManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping topod must match before a managed request may stop it. */
export type TopodManagedStopContext = Omit<
  TopodManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const TopodManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const TopodDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = TopodManagedStopRequestSchema.shape

export const TopodManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('topod_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping topod observed about its daemon, written before it exits. */
export const TopodDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('topod_managed_stop_retirement'),
  request: TopodManagedStopRequestSchema,
  retirement: TopodDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const TopodCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('topod_managed_stop_completed'),
  request: TopodManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: TopodDaemonRetirementVerdictSchema.optional()
})

export type TopodManagedStopVerdict = z.infer<typeof TopodManagedStopVerdictSchema>
export type TopodManagedStopCompletion = z.infer<typeof TopodManagedStopCompletionSchema>
export type TopodCompletedStopReceipt = z.infer<typeof TopodCompletedStopReceiptSchema>
export type TopodDaemonRetirementVerdict = z.infer<typeof TopodDaemonRetirementVerdictSchema>
export type TopodDaemonRetirementRecord = z.infer<typeof TopodDaemonRetirementRecordSchema>

export const TOPOD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const TOPOD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only topod dispatch or client cancellation can win. */
export const TopodManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('topod_managed_stop_decision'),
  request: TopodManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means topod already acted on the request; the caller must await its exit. */
export const TopodManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('topod_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type TopodManagedStopDecision = z.infer<typeof TopodManagedStopDecisionSchema>
export type TopodManagedStopCancellation = z.infer<typeof TopodManagedStopCancellationSchema>
