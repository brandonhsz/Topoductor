// Export copies of relay-hosted SSH state without mutating source rows.
import {
  TOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type TopodMigrationTerminalScrollbackSnapshot
} from '../../../shared/topod-migration/topod-migration-scrollback'
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationDormantStatePayload,
  TopodMigrationManifest,
  TopodMigrationManifestSource
} from '../../../shared/topod-migration/topod-migration-manifest'
import { assertTopodMigrationManifestDigest } from '../../topod/topod-migration-manifest-digest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  collectTopodMigrationUntransferredDependencyCensus,
  type TopodMigrationSourceDependencyCensus
} from './topod-source-dependency-census'
import {
  collectTopodMigrationSourceDormantState,
  type TopodMigrationSourceDormantInspection
} from './topod-source-dormant-state'
import { readTopodMigrationSourceScrollbackChunk } from './topod-source-scrollback-state'
import {
  createTopodMigrationDeltaView,
  type TopodMigrationDeltaView
} from './topod-source-delta-view'
import { syncTopodMigrationScrollbackRetention } from './topod-source-scrollback-retention'
import { createTopodMigrationLeaveBehindView } from './topod-source-leave-behind-view'
import {
  collectTopodMigrationSourceDrafts,
  type TopodMigrationSourceDrafts
} from './topod-source-draft-rename'

type TopodSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const topodSourceExportContext = Symbol('TopodSourceExportPersistence')

export class TopodSourceExportPersistence {
  readonly [topodSourceExportContext]: TopodSourceExportRuntime

  constructor(runtime: TopodSourceExportRuntime) {
    this[topodSourceExportContext] = runtime
  }

  collectTopodMigrationSourceDormantState(
    source: TopodMigrationManifestSource,
    catalog: TopodMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): TopodMigrationDormantStatePayload {
    const runtime = this[topodSourceExportContext]
    return collectTopodMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  /** The export plus what it could not carry, for a move that must refuse rather than drop rows. */
  inspectTopodMigrationSourceDormantState(
    source: TopodMigrationManifestSource,
    catalog: TopodMigrationCatalogPayload,
    destinationEnvironmentId?: string,
    daemonHistoryLeaf?: (tabId: string, leafId: string) => boolean
  ): TopodMigrationSourceDormantInspection {
    const runtime = this[topodSourceExportContext]
    return collectTopodMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId,
      daemonHistoryLeaf
    )
  }

  collectTopodMigrationSourceDrafts(manifest: TopodMigrationManifest): TopodMigrationSourceDrafts {
    return collectTopodMigrationSourceDrafts(this[topodSourceExportContext].state, manifest)
  }

  createTopodMigrationDeltaView(moved: TopodMigrationManifest): TopodMigrationDeltaView {
    return createTopodMigrationDeltaView(this[topodSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createTopodMigrationLeaveBehindView(targetId: string): TopodMigrationDeltaView {
    return createTopodMigrationLeaveBehindView(this[topodSourceExportContext], targetId)
  }

  inspectTopodMigrationUntransferredDependencies(
    manifest: TopodMigrationManifest
  ): TopodMigrationSourceDependencyCensus {
    const runtime = this[topodSourceExportContext]
    return collectTopodMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncTopodMigrationScrollbackRetention(pending: readonly TopodMigrationManifest[]): void {
    syncTopodMigrationScrollbackRetention(this[topodSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readTopodMigrationSourceSnapshotChunk(
    manifest: TopodMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertTopodMigrationManifestDigest(manifest)
    const descriptor: TopodMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('topod_migration_source_snapshot_unknown')
    }
    const runtime = this[topodSourceExportContext]
    return readTopodMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: TOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
