import {
  topodActivationTransactionPath,
  parseTopodActivationTransaction,
  serializeTopodActivationTransaction,
  type TopodActivationTransaction
} from './topod-activation-transaction'
import {
  readBoundedTopodRemoteRecord,
  writeAtomicTopodRemoteRecord
} from '../install/topod-remote-record-file'
import type { TopodRemoteExecTarget } from '../install/topod-remote-runtime-control'
import { currentTopodFence } from './topod-activation-fence-scope'

const TOPOD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type TopodActivationTransactionStoreOptions = TopodRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readTopodActivationTransaction(
  options: TopodActivationTransactionStoreOptions
): Promise<TopodActivationTransaction | null> {
  const read = await readBoundedTopodRemoteRecord(
    options,
    topodActivationTransactionPath(options.host, options.remoteHome),
    TOPOD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseTopodActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's topod activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeTopodActivationTransaction(
  options: TopodActivationTransactionStoreOptions,
  transaction: TopodActivationTransaction
): Promise<void> {
  const fenceToken = currentTopodFence()?.token
  return writeAtomicTopodRemoteRecord(
    options,
    topodActivationTransactionPath(options.host, options.remoteHome),
    serializeTopodActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
