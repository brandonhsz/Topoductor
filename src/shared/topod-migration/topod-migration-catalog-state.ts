import { normalizeTopodMigrationImportReceipts } from './topod-migration-manifest-validation'
import type {
  TopodMigrationCatalogAbortResult,
  TopodMigrationCatalogReference,
  TopodMigrationCatalogReferenceAbortResult,
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from './topod-migration-manifest'
import { parseTopodMigrationSnapshotUploadStates } from './topod-migration-scrollback'
import { parseTopodMigrationBlobUploadStates } from './topod-migration-blob-transfer'
import { isRecord } from './topod-migration-manifest-fields'

export function parseTopodMigrationCatalogState(
  value: unknown,
  manifest: TopodMigrationManifest
): TopodMigrationCatalogState {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('topod_migration_catalog_state_identity_mismatch')
  }
  if (record.state === 'absent') {
    return { state: 'absent', ...migrationIdentity(manifest) }
  }
  if (record.state === 'staged') {
    const stagedAt = requireDate(record.stagedAt)
    const snapshotUploads = parseTopodMigrationSnapshotUploadStates(
      record.snapshotUploads,
      manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
    )
    const blobUploads = parseTopodMigrationBlobUploadStates(record.blobUploads)
    return {
      state: 'staged',
      ...migrationIdentity(manifest),
      stagedAt,
      ...(snapshotUploads ? { snapshotUploads } : {}),
      ...(blobUploads ? { blobUploads } : {})
    }
  }
  if (record.state === 'committed') {
    const receipt = normalizeTopodMigrationImportReceipts([record.receipt])[0]
    if (
      !receipt ||
      receipt.migrationId !== manifest.migrationId ||
      receipt.manifestSha256 !== manifest.manifestSha256
    ) {
      throw new Error('topod_migration_catalog_state_receipt_invalid')
    }
    return { state: 'committed', ...migrationIdentity(manifest), receipt }
  }
  // No known arm is safe to assume for a newer host's state; stop with an actionable reason.
  if (typeof record.state === 'string') {
    throw new Error('topod_migration_catalog_state_unsupported:client_update_required')
  }
  throw new Error('topod_migration_catalog_state_invalid')
}

export function parseTopodMigrationCatalogAbortResult(
  value: unknown,
  manifest: TopodMigrationManifest
): TopodMigrationCatalogAbortResult {
  const state = parseTopodMigrationCatalogState(value, manifest)
  const record = requireRecord(value)
  if (typeof record.aborted !== 'boolean') {
    throw new Error('topod_migration_catalog_abort_result_invalid')
  }
  if (
    record.durableAbsent !== undefined &&
    (record.durableAbsent !== true || state.state !== 'absent')
  ) {
    throw new Error('topod_migration_catalog_abort_durability_invalid')
  }
  return {
    ...state,
    aborted: record.aborted,
    ...(record.durableAbsent === true ? { durableAbsent: true as const } : {})
  }
}

/** Absent only with the host's flush behind it: an unflushed abort could come back on restart. */
export function parseTopodMigrationCatalogReferenceAbortResult(
  value: unknown,
  manifest: TopodMigrationCatalogReference
): TopodMigrationCatalogReferenceAbortResult {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('topod_migration_catalog_state_identity_mismatch')
  }
  if (typeof record.aborted !== 'boolean') {
    throw new Error('topod_migration_catalog_abort_result_invalid')
  }
  if (record.state === 'committed') {
    return {
      state: 'committed',
      ...migrationIdentity(manifest),
      aborted: false,
      ...(record.durableCommitted === true ? { durableCommitted: true as const } : {})
    }
  }
  if (record.state === 'absent' && record.durableAbsent === true) {
    return {
      state: 'absent',
      ...migrationIdentity(manifest),
      aborted: record.aborted,
      durableAbsent: true
    }
  }
  throw new Error('topod_migration_catalog_abort_durability_invalid')
}

function migrationIdentity(manifest: TopodMigrationCatalogReference) {
  return { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('topod_migration_catalog_state_invalid')
  }
  return value
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('topod_migration_catalog_state_staged_at_invalid')
  }
  return value
}
