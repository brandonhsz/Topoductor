import type {
  TopodMigrationCatalogAbortResult,
  TopodMigrationCatalogReference,
  TopodMigrationCatalogReferenceAbortResult,
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import type {
  TopodMigrationSnapshotChunkRequest,
  TopodMigrationSnapshotChunkResult
} from '../../../../shared/topod-migration/topod-migration-scrollback'
import type {
  TopodMigrationBlobChunkRequest,
  TopodMigrationBlobChunkResult,
  TopodMigrationBlobDescriptor
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import {
  abortStagedTopodMigrationCatalogByReferenceDurably,
  abortStagedTopodMigrationCatalogDurably,
  commitStagedTopodMigrationCatalogDurably,
  getTopodMigrationCatalogState,
  stageTopodMigrationCatalogDurably
} from './topod-migration-catalog-import'
import { TopoRuntimeWithResolveExitWaiters } from '../../terminal/wait/terminal-wait-settlements'
import type { RuntimeStore } from '../../construction/runtime-store-contract'

type MigrationStoreKey =
  | 'stageTopodMigrationCatalog'
  | 'commitStagedTopodMigrationCatalog'
  | 'stageTopodMigrationSnapshotChunk'
  | 'stageTopodMigrationBlobChunk'
  | 'abortStagedTopodMigrationCatalog'
  | 'abortStagedTopodMigrationCatalogByReference'
  | 'getTopodMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

export abstract class TopoRuntimeWithMigrationCatalog extends TopoRuntimeWithResolveExitWaiters {
  async stageTopodMigrationCatalog(
    manifest: TopodMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<TopodMigrationCatalogState> {
    return stageTopodMigrationCatalogDurably({
      store: this.requireMigrationStore('stageTopodMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedTopodMigrationCatalog(
    manifest: TopodMigrationManifest,
    options: {
      signal?: AbortSignal
      expectedBlobs?: readonly TopodMigrationBlobDescriptor[]
    } = {}
  ): Promise<TopodMigrationCatalogState> {
    return commitStagedTopodMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedTopodMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageTopodMigrationSnapshotChunk(
    request: TopodMigrationSnapshotChunkRequest
  ): TopodMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageTopodMigrationSnapshotChunk')
      .stageTopodMigrationSnapshotChunk!(request)
  }

  stageTopodMigrationBlobChunk(
    request: TopodMigrationBlobChunkRequest
  ): TopodMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageTopodMigrationBlobChunk').stageTopodMigrationBlobChunk!(
      request
    )
  }

  async abortStagedTopodMigrationCatalog(
    manifest: TopodMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<TopodMigrationCatalogAbortResult> {
    return abortStagedTopodMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedTopodMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedTopodMigrationCatalogByReference(
    reference: TopodMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<TopodMigrationCatalogReferenceAbortResult> {
    return abortStagedTopodMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedTopodMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getTopodMigrationCatalogState(manifest: TopodMigrationManifest): TopodMigrationCatalogState {
    return getTopodMigrationCatalogState({
      store: this.requireMigrationStore('getTopodMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingTopodMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingTopodMigrationReceivedBlobs ||
      !store.hasPendingTopodMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[topod-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingTopodMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<TopoRuntimeWithResolveExitWaiters['onPtyExit']>
  ): ReturnType<TopoRuntimeWithResolveExitWaiters['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredTopodMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[topod-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
