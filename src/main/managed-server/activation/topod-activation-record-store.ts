// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { TopodHostTransport } from '../install/topod-host-transport'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'
import {
  TOPOD_ACTIVATION_FILENAME,
  emptyTopodActivationRecord,
  parseTopodActivationRecord,
  serializeTopodActivationRecord,
  type TopodActivationReadResult,
  type TopodActivationRecord
} from './topod-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  readBoundedTopodRemoteRecord,
  writeAtomicTopodRemoteRecord
} from '../install/topod-remote-record-file'

const TOPOD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

export function topodActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, TOPOD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<TopodActivationReadResult> {
  const read = await readBoundedTopodRemoteRecord(
    options,
    topodActivationPath(options.host, options.remoteHome),
    TOPOD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseTopodActivationRecord(read.raw)
}

export async function readTopodActivationRecord(
  options: ActivationRecordTarget
): Promise<TopodActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's topod activation record: ${parsed.reason}`)
  }
  return emptyTopodActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeTopodActivationRecord(
  options: ActivationRecordTarget,
  record: TopodActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(`Refusing to overwrite this host's topod activation record: ${existing.reason}`)
  }
  await writeAtomicTopodRemoteRecord(
    options,
    topodActivationPath(options.host, options.remoteHome),
    serializeTopodActivationRecord(record)
  )
}
