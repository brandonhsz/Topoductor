// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_TOPOD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/topod-migration/topod-migration-manifest-validation'
import type {
  TopodMigrationImportReceipt,
  TopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest'
import { MAX_TOPOD_MIGRATION_EVICTED_RECEIPTS } from '../../../shared/topod-migration/topod-migration-evicted-receipts'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  topodMigrationStagingKey,
  type TopodMigrationRequestIdentity
} from './topod-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const TOPOD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findTopodMigrationImportReceipt(
  state: PersistedState,
  manifest: TopodMigrationManifest
): TopodMigrationImportReceipt | undefined {
  const receipt = state.topodMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.topodMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordTopodMigrationImportReceipt(
  state: PersistedState,
  receipt: TopodMigrationImportReceipt
): void {
  const receipts = [...(state.topodMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_TOPOD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.topodMigrationEvictedReceipts = [
      ...(state.topodMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_TOPOD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.topodMigrationImportReceipts = receipts.slice(-MAX_TOPOD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveTopodMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < TOPOD_MIGRATION_STAGE_TTL_MS
}

export function expireTopodMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.topodMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveTopodMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.topodMigrationStagedCatalogs = live
  return true
}

export type TopodMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'topodMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordTopodMigrationCommitWriteGeneration(
  runtime: TopodMigrationCommitGenerationRuntime,
  migration: TopodMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.topodMigrationCommitWriteGenerations.set(
    topodMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isTopodMigrationCommitDurable(
  runtime: TopodMigrationCommitGenerationRuntime,
  migration: TopodMigrationRequestIdentity
): boolean {
  const key = topodMigrationStagingKey(migration)
  const required = runtime.topodMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.topodMigrationCommitWriteGenerations.delete(key)
  return true
}
