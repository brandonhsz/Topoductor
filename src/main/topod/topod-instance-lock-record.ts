import { z } from 'zod'
import { readBoundedLockFile } from './topod-instance-lock-reclaim'

const TopodLockRecordSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Null means PID alone supplies the weaker fence. */
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Drift-free Linux identity; tolerate unknown future encodings without losing the whole record. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  identity: z.string().min(1).max(1_024),
  version: z.string().min(1).max(255),
  acquiredAt: z.iso.datetime({ offset: true }),
  nonce: z.string().min(1).max(255),
  /** Older pre-desktop-sharing records omit role. */
  role: z.enum(['topod', 'desktop']).optional(),
  /** Shared homes require machine identity: foreign PIDs establish no local liveness. */
  machineIdentity: z.string().min(1).max(255).optional().catch(undefined),
  /** Optional legacy-compatible hostname for stale-lock reclaim hints. */
  host: z.string().min(1).max(255).optional().catch(undefined)
})

export type TopodLockRecord = z.infer<typeof TopodLockRecordSchema>

/** Unreadable/malformed/oversized/absent returns null; this does not prove the lock is free. */
export function readTopodInstanceLockRecord(path: string): TopodLockRecord | null {
  return parseTopodInstanceLockRecord(readBoundedLockFile(path) ?? '')
}

export function parseTopodInstanceLockRecord(content: string): TopodLockRecord | null {
  try {
    const result = TopodLockRecordSchema.safeParse(JSON.parse(content))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function describeLockHolder(record: TopodLockRecord): string {
  return record.role === 'desktop' ? 'The Topo desktop app' : 'Another topod'
}
