import { MAX_TOPOD_MIGRATION_STAGED_CATALOGS } from '../../../shared/topod-migration/topod-migration-staged-catalog-validation'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../shared/topod-migration/topod-migration-manifest-validation'
import type {
  TopodMigrationCatalogAbortResult,
  TopodMigrationCatalogReference,
  TopodMigrationCatalogReferenceAbortResult,
  TopodMigrationCatalogState,
  TopodMigrationImportReceipt,
  TopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest'
import type {
  TopodMigrationSnapshotChunkRequest,
  TopodMigrationSnapshotChunkResult
} from '../../../shared/topod-migration/topod-migration-scrollback'
import type {
  TopodMigrationBlobChunkRequest,
  TopodMigrationBlobChunkResult,
  TopodMigrationBlobDescriptor
} from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { WriteSchedulingOperations } from '../loading-store/write-scheduling'
import { scheduleSave } from '../loading-store/write-scheduling'
import {
  applyPreparedTopodMigrationCatalog,
  assertTopodMigrationReceiptMatchesManifest,
  assertSameTopodMigrationManifest,
  prepareTopodMigrationCatalog,
  type PreparedTopodMigrationCatalog
} from './topod-catalog-records'
import {
  expireTopodMigrationStages,
  findTopodMigrationImportReceipt,
  isLiveTopodMigrationStage,
  recordTopodMigrationCommitWriteGeneration,
  recordTopodMigrationImportReceipt,
  type TopodMigrationCommitGenerationRuntime
} from './topod-catalog-receipt-ledger'
import {
  abortTopodMigrationSnapshots,
  assertTopodMigrationSnapshotsReady,
  commitTopodMigrationSnapshots,
  inspectTopodMigrationSnapshotUploads,
  pruneTopodMigrationSnapshotStaging,
  stageTopodMigrationSnapshotChunk
} from './topod-scrollback-snapshot-transfer'
import {
  abortTopodMigrationBlobs,
  assertTopodMigrationBlobSetMatches,
  assertTopodMigrationBlobsReady,
  commitTopodMigrationBlobs,
  inspectTopodMigrationBlobUploads,
  pruneTopodMigrationBlobStaging,
  stageTopodMigrationBlobChunk
} from './topod-migration-blob-staging'
import { withStagedAutomationRunHistory } from './topod-staged-automation-run-history'
import { assertTopodMigrationBlobContentsValid } from './topod-migration-blob-installers'
import {
  abortTopodMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './topod-catalog-reference-abort'

type TopodCatalogImportRuntime = TopodMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'topodMigrationBlobRoot'>

const topodCatalogImportContext = Symbol('TopodCatalogImportPersistence')
type TopodCatalogImportContext = {
  runtime: TopodCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.
export class TopodCatalogImportPersistence {
  readonly [topodCatalogImportContext]: TopodCatalogImportContext

  constructor(
    runtime: TopodCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[topodCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageTopodMigrationCatalog(
    manifest: TopodMigrationManifest,
    options: { now?: () => Date } = {}
  ): TopodMigrationCatalogState {
    const context = this[topodCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireTopodMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling)
    }
    pruneTopodMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneTopodMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.topodMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareTopodMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.topodMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_TOPOD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('topod_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.topodMigrationStagedCatalogs = [
      ...staged,
      {
        version: TOPOD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling)
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageTopodMigrationSnapshotChunk(
    request: TopodMigrationSnapshotChunkRequest
  ): TopodMigrationSnapshotChunkResult {
    const context = this[topodCatalogImportContext]
    return stageTopodMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageTopodMigrationBlobChunk(
    request: TopodMigrationBlobChunkRequest
  ): TopodMigrationBlobChunkResult {
    const context = this[topodCatalogImportContext]
    return stageTopodMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.topodMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedTopodMigrationCatalog(
    manifest: TopodMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly TopodMigrationBlobDescriptor[] } = {}
  ): TopodMigrationCatalogState {
    const context = this[topodCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('topod_migration_catalog_not_staged')
    }
    const blobRoot = context.runtime.topodMigrationBlobRoot
    assertTopodMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertTopodMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertTopodMigrationBlobsReady(manifest, blobRoot)
    assertTopodMigrationBlobContentsValid(manifest, blobRoot)
    const prepared = prepareTopodMigrationCatalog(
      withStagedAutomationRunHistory(manifest, blobRoot),
      context.runtime.state
    )
    commitTopodMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitTopodMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling)
    recordTopodMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedTopodMigrationCatalog(
    manifest: TopodMigrationManifest
  ): TopodMigrationCatalogAbortResult {
    const context = this[topodCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.topodMigrationStagedCatalogs = (
      context.runtime.state.topodMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortTopodMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortTopodMigrationBlobs(manifest, context.runtime.topodMigrationBlobRoot)
    scheduleSave(context.scheduling)
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedTopodMigrationCatalogByReference(
    reference: TopodMigrationCatalogReference
  ): TopodMigrationCatalogReferenceAbortResult {
    return abortTopodMigrationCatalogByReference(
      this[topodCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedTopodMigrationCatalog(manifest)
    )
  }

  getTopodMigrationCatalogState(manifest: TopodMigrationManifest): TopodMigrationCatalogState {
    const context = this[topodCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedTopodMigrationCatalog(now: number = Date.now()): boolean {
    return (this[topodCatalogImportContext].runtime.state.topodMigrationStagedCatalogs ?? []).some(
      (entry) => isLiveTopodMigrationStage(entry.stagedAt, now)
    )
  }
}

function commitPreparedCatalog(
  context: TopodCatalogImportContext,
  manifest: TopodMigrationManifest,
  prepared: PreparedTopodMigrationCatalog,
  now?: () => Date
): TopodMigrationImportReceipt {
  applyPreparedTopodMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: TopodMigrationImportReceipt = {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.topodMigrationStagedCatalogs = (
    context.runtime.state.topodMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordTopodMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: TopodCatalogImportRuntime,
  manifest: TopodMigrationManifest
): TopodMigrationCatalogState {
  const { state } = runtime
  const receipt = findTopodMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.topodMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameTopodMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: TopodMigrationImportReceipt,
  manifest: TopodMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('topod_migration_id_reused_with_different_manifest')
  }
  assertTopodMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: TopodMigrationManifest): TopodMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: TopodMigrationManifest,
  stagedAt: string,
  runtime: TopodCatalogImportRuntime
): TopodMigrationCatalogState {
  const snapshotUploads = inspectTopodMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectTopodMigrationBlobUploads(manifest, runtime.topodMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: TopodMigrationImportReceipt): TopodMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
