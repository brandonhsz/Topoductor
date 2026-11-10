// Journal before mutation and retain until the recorded slot is restored; recordAfter/core matching determines commit during recovery.
import {
  parseTopodActivationRecord,
  coreTopodActivationRecord,
  serializeTopodActivationRecord,
  type TopodActivationRecord
} from './topod-activation-record'
import {
  type TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
  TopodActivationTransactionSchema
} from './topod-activation-transaction-schema'
import {
  topodDecommissionJournal,
  topodDecommissionTransactionDefect,
  planTopodDecommissionRecovery,
  type TopodDecommissionRecoveryPlan,
  type TopodDecommissionTransaction
} from '../lifecycle/topod-decommission-transaction'
import { errorMessage } from '../../../shared/error-message'
import { RELAY_INSTALL_LOCK_NAME } from '../../../shared/relay-install-lock-name'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

export const TOPOD_ACTIVATION_TRANSACTION_FILENAME = 'transaction.json'
export const TOPOD_ACTIVATION_TRANSACTION_DIRNAME = '.topod-activation-transaction'

export function topodActivationTransactionRoot(
  host: RemoteHostPlatform,
  remoteHome: string
): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, TOPOD_ACTIVATION_TRANSACTION_DIRNAME)
}

export function topodActivationFenceLockDir(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(
    host,
    topodActivationTransactionRoot(host, remoteHome),
    RELAY_INSTALL_LOCK_NAME
  )
}

export function topodActivationTransactionPath(
  host: RemoteHostPlatform,
  remoteHome: string
): string {
  return joinRemotePath(
    host,
    topodActivationTransactionRoot(host, remoteHome),
    TOPOD_ACTIVATION_TRANSACTION_FILENAME
  )
}

export type TopodSnapshotVerdict = {
  dirName: string
  state: 'pending' | 'captured' | 'empty'
}

export type TopodActivateTransaction = {
  schemaVersion: typeof TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'activate'
  phase: 'prepared' | 'incumbent-stopped' | 'snapshot-captured' | 'candidate-ready'
  startedAt: string
  updatedAt: string
  candidateVersion: string
  /** Retain the initiating app version when recovery finishes the activation commit. */
  candidateAppVersion?: string | null
  recordBefore: TopodActivationRecord
  recordAfter: TopodActivationRecord | null
  snapshot: TopodSnapshotVerdict
}

export type TopodRollbackTransaction = {
  schemaVersion: typeof TOPOD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'rollback'
  phase:
    | 'prepared'
    | 'incumbent-stopped'
    | 'rescue-captured'
    | 'rollback-state-restored'
    | 'target-ready'
  startedAt: string
  updatedAt: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: TopodActivationRecord
  recordAfter: TopodActivationRecord
  rescue: TopodSnapshotVerdict
}

export type TopodActivationTransaction =
  | TopodActivateTransaction
  | TopodRollbackTransaction
  | TopodDecommissionTransaction

type TopodActivationTransactionReadResult =
  | { state: 'absent' }
  | { state: 'ok'; transaction: TopodActivationTransaction }
  | { state: 'unreadable'; reason: string }

/** Recovery must quiesce the launched slot before undoing state. */
type TopodTransactionRecoveryPlan =
  | { action: 'stabilize-committed'; activeVersion: string | null }
  /** Candidate passed readiness; only committing its journaled activation record remains. */
  | { action: 'finish-commit'; record: TopodActivationRecord }
  | {
      action: 'undo'
      /** Slot that may have used state after the handoff. */
      launchedVersion: string | null
      activeVersion: string | null
      restoreState: TopodSnapshotVerdict | null
      launchedFromState?: TopodSnapshotVerdict | null
    }
  | TopodDecommissionRecoveryPlan
  | { action: 'refuse'; code: string; reason: string }

export function parseTopodActivationTransaction(
  raw: string | null
): TopodActivationTransactionReadResult {
  if (raw === null || raw.trim() === '') {
    return { state: 'absent' }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    return unreadable(`transaction is not JSON: ${errorMessage(error)}`)
  }
  const parsed = TopodActivationTransactionSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? issue.path.join('.') : 'transaction'
    return unreadable(`${path} is invalid: ${issue?.message ?? 'unknown shape'}`)
  }
  const recordBefore = parseNestedRecord(parsed.data.recordBefore, 'recordBefore')
  if (recordBefore.state === 'unreadable') {
    return recordBefore
  }
  if (parsed.data.operation === 'decommission') {
    const after = parseNestedRecord(parsed.data.recordAfter, 'recordAfter')
    if (after.state === 'unreadable') {
      return after
    }
    const { dispatched, ...journal } = parsed.data
    const transaction = {
      ...journal,
      ...dispatched,
      recordBefore: recordBefore.record,
      recordAfter: after.record
    }
    const defect = topodDecommissionTransactionDefect(transaction)
    return defect ? unreadable(defect) : { state: 'ok', transaction }
  }
  if (parsed.data.operation === 'activate') {
    const recordAfter =
      parsed.data.recordAfter === null
        ? null
        : parseNestedRecord(parsed.data.recordAfter, 'recordAfter')
    if (recordAfter?.state === 'unreadable') {
      return recordAfter
    }
    if (recordAfter && recordAfter.record.active !== parsed.data.candidateVersion) {
      return unreadable('recordAfter does not activate candidateVersion')
    }
    return {
      state: 'ok',
      transaction: {
        ...parsed.data,
        recordBefore: recordBefore.record,
        recordAfter: recordAfter?.record ?? null
      }
    }
  }
  const recordAfter = parseNestedRecord(parsed.data.recordAfter, 'recordAfter')
  if (recordAfter.state === 'unreadable') {
    return recordAfter
  }
  if (
    recordBefore.record.active !== parsed.data.incumbentVersion ||
    recordBefore.record.previous !== parsed.data.targetVersion
  ) {
    return unreadable('rollback versions do not match recordBefore')
  }
  if (
    recordAfter.record.active !== parsed.data.targetVersion ||
    recordAfter.record.previous !== null ||
    recordAfter.record.snapshot !== null
  ) {
    return unreadable('recordAfter is not a completed rollback record')
  }
  return {
    state: 'ok',
    transaction: {
      ...parsed.data,
      recordBefore: recordBefore.record,
      recordAfter: recordAfter.record
    }
  }
}

export function serializeTopodActivationTransaction(
  transaction: TopodActivationTransaction & { fenceToken?: string }
): string {
  // Decommission serialization must preserve any existing fenceToken.
  const journal =
    transaction.operation === 'decommission' ? topodDecommissionJournal(transaction) : transaction
  return `${JSON.stringify(journal, null, 2)}\n`
}

export function planTopodTransactionRecovery(
  transaction: TopodActivationTransaction,
  currentRecord: TopodActivationRecord
): TopodTransactionRecoveryPlan {
  if (transaction.operation === 'decommission') {
    const committed = sameTopodActivationRecord(currentRecord, transaction.recordAfter)
    return committed || sameTopodActivationRecord(currentRecord, transaction.recordBefore)
      ? planTopodDecommissionRecovery(transaction, committed)
      : recordChangedRefusal(transaction)
  }
  if (
    transaction.recordAfter &&
    sameTopodActivationRecord(currentRecord, transaction.recordAfter)
  ) {
    return {
      action: 'stabilize-committed',
      activeVersion: transaction.recordAfter.active
    }
  }
  if (!sameTopodActivationRecord(currentRecord, transaction.recordBefore)) {
    return recordChangedRefusal(transaction)
  }
  if (transaction.phase === 'candidate-ready' || transaction.phase === 'target-ready') {
    return {
      action: 'finish-commit',
      record: transaction.recordAfter ?? neverRecord()
    }
  }
  if (transaction.operation === 'activate') {
    // Launch follows a durable snapshot verdict.
    const launched = transaction.phase === 'snapshot-captured'
    return {
      action: 'undo',
      launchedVersion: launched ? transaction.candidateVersion : null,
      activeVersion: transaction.recordBefore.active,
      restoreState: launched ? transaction.snapshot : null
    }
  }
  // Rescue holds incumbent state; restore it once target-state replacement may have begun.
  const replaced = transaction.phase === 'rollback-state-restored'
  const rescued = replaced || transaction.phase === 'rescue-captured'
  return {
    action: 'undo',
    launchedVersion: replaced ? transaction.targetVersion : null,
    activeVersion: transaction.incumbentVersion,
    // A mid-restore crash retains rescue-captured even when live state is already partly replaced.
    restoreState: rescued ? transaction.rescue : null,
    launchedFromState: replaced ? rollbackStartingState(transaction) : null
  }
}

export function rollbackStartingState(
  transaction: Pick<TopodRollbackTransaction, 'recordBefore'>
): TopodSnapshotVerdict | null {
  const snapshot = transaction.recordBefore.snapshot
  return snapshot ? { dirName: snapshot.dirName, state: 'captured' } : null
}

export function sameTopodActivationRecord(
  left: TopodActivationRecord,
  right: TopodActivationRecord
): boolean {
  return (
    serializeTopodActivationRecord(coreTopodActivationRecord(left)) ===
    serializeTopodActivationRecord(coreTopodActivationRecord(right))
  )
}

function parseNestedRecord(
  value: unknown,
  field: string
): { state: 'ok'; record: TopodActivationRecord } | { state: 'unreadable'; reason: string } {
  const parsed = parseTopodActivationRecord(JSON.stringify(value))
  return parsed.state === 'ok'
    ? { state: 'ok', record: parsed.record }
    : unreadable(
        `${field} is invalid: ${parsed.state === 'absent' ? 'record is absent' : parsed.reason}`
      )
}

function recordChangedRefusal(
  transaction: TopodActivationTransaction
): Extract<TopodTransactionRecoveryPlan, { action: 'refuse' }> {
  return {
    action: 'refuse',
    code: 'topod_recovery_activation_record_changed',
    reason:
      `The activation record matches neither side of the interrupted ${transaction.operation}. ` +
      'Preserving the activation fence for operator inspection.'
  }
}

function neverRecord(): never {
  throw new Error('A committed phase must carry its record; the schema enforces this.')
}

function unreadable(reason: string): { state: 'unreadable'; reason: string } {
  return { state: 'unreadable', reason }
}
