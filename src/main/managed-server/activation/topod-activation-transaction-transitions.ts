import type { TopodActivationRecord } from './topod-activation-record'
import { TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './topod-activation-transaction-schema'
import type {
  TopodActivateTransaction,
  TopodRollbackTransaction
} from './topod-activation-transaction'

export function createTopodActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: TopodActivationRecord
  snapshotDirName: string
  now: Date
}): TopodActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withTopodActivationIncumbentStopped(
  transaction: TopodActivateTransaction,
  now: Date
): TopodActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withTopodActivationSnapshot(
  transaction: TopodActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): TopodActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withTopodActivationCandidateReady(
  transaction: TopodActivateTransaction,
  recordAfter: TopodActivationRecord,
  now: Date
): TopodActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createTopodRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: TopodActivationRecord
  recordAfter: TopodActivationRecord
  rescueDirName: string
  now: Date
}): TopodRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withTopodRollbackPhase(
  transaction: TopodRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): TopodRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withTopodRollbackRescue(
  transaction: TopodRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): TopodRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
