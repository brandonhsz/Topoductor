/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { topodInstallDirNames } from './topod-activation-record'
import type { TopodActivationTransaction } from './topod-activation-transaction'
import { readTopodActivationTransaction } from './topod-activation-transaction-store'
import { topodActivationFenceExists } from './topod-activation-lock'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import type { TopodRemoteExecTarget } from '../install/topod-remote-runtime-control'

type TopodGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: TopodActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readTopodGcTransactionPins(
  target: TopodRemoteExecTarget & { remoteHome: string },
  /** The caller holds the activation fence, so its presence says nothing about another owner. */
  options: { callerHoldsFence?: boolean } = {}
): Promise<TopodGcTransactionPins> {
  try {
    const transaction = await readTopodActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return !options.callerHoldsFence && (await topodActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: topodInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
