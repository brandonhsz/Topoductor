// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  TOPOD_IDLE_STOP_RECORD_FILENAME,
  TopodIdleStopRecordSchema,
  type TopodIdleStopRecord
} from '../../shared/topod-idle-exit'
import type { TopodIdleExitEvidence } from './topod-idle-exit-monitor'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function topodIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, TOPOD_IDLE_STOP_RECORD_FILENAME)
}

export function writeTopodIdleStopRecord(
  userDataPath: string,
  evidence: TopodIdleExitEvidence,
  version: string
): void {
  const record: TopodIdleStopRecord = {
    schemaVersion: 1,
    kind: 'topod_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(topodIdleStopRecordPath(userDataPath), record)) {
    throw new Error('topod_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeTopodIdleStopRecord(userDataPath: string): TopodIdleStopRecord | null {
  const path = topodIdleStopRecordPath(userDataPath)
  let record: TopodIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = TopodIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[topod] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardTopodIdleStopRecord(userDataPath: string): void {
  rmSync(topodIdleStopRecordPath(userDataPath), { force: true })
}
