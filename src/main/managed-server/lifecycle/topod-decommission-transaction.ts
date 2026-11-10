// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeTopodActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type TopodActivationRecord
} from '../activation/topod-activation-record'
import { TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/topod-activation-transaction-schema'
import type { TopodManagedStopRequest } from '../../../shared/topod-stop-request'

export type TopodDecommissionTransaction = {
  schemaVersion: typeof TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: TopodActivationRecord
  recordAfter: TopodActivationRecord
  request: TopodManagedStopRequest | null
}

/** Released desktops drop this field. */
type TopodDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: TopodManagedStopRequest
}

type TopodDecommissionJournal = Omit<TopodDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: TopodDecommissionDispatch
}

export type TopodDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: TopodActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: TopodManagedStopRequest; record: TopodActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createTopodDecommissionTransaction(options: {
  transactionId: string
  recordBefore: TopodActivationRecord & { active: string }
  now: Date
}): TopodDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withTopodDecommissionStopDispatched(
  transaction: TopodDecommissionTransaction,
  request: TopodManagedStopRequest,
  now: Date
): TopodDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withTopodDecommissionProcessExited(
  transaction: TopodDecommissionTransaction,
  now: Date
): TopodDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function topodDecommissionJournal(
  transaction: TopodDecommissionTransaction
): TopodDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function topodDecommissionTransactionDefect(
  transaction: TopodDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeTopodActivationRecord(transaction.recordAfter) !==
    serializeTopodActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planTopodDecommissionRecovery(
  transaction: TopodDecommissionTransaction,
  committed: boolean
): TopodDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedTopodDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedTopodDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedTopodDecommissionRecord(
  transaction: TopodDecommissionTransaction
): TopodActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
