import type {
  TopodMigrationCatalogAbortResult,
  TopodMigrationCatalogReference,
  TopodMigrationCatalogReferenceAbortResult,
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import type { TopodMigrationBlobDescriptor } from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import type { Store } from '../../../persistence/loading-store/store'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type TopodMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type TopodMigrationCatalogStageStore = TopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageTopodMigrationCatalog'>>
type TopodMigrationCatalogCommitStore = TopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedTopodMigrationCatalog' | 'installTopodMigrationReceivedBlobs'>>
type TopodMigrationCatalogAbortStore = TopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedTopodMigrationCatalog'>>
type TopodMigrationCatalogAbortByReferenceStore = TopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedTopodMigrationCatalogByReference'>>

export async function stageTopodMigrationCatalogDurably(args: {
  store: TopodMigrationCatalogStageStore
  manifest: TopodMigrationManifest
  signal?: AbortSignal
}): Promise<TopodMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageTopodMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedTopodMigrationCatalogDurably(args: {
  store: TopodMigrationCatalogCommitStore
  manifest: TopodMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly TopodMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<TopodMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedTopodMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installTopodMigrationReceivedBlobs'>>,
  manifest: TopodMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installTopodMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[topod-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedTopodMigrationCatalogDurably(args: {
  store: TopodMigrationCatalogAbortStore
  manifest: TopodMigrationManifest
  signal?: AbortSignal
}): Promise<TopodMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedTopodMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedTopodMigrationCatalogByReferenceDurably(args: {
  store: TopodMigrationCatalogAbortByReferenceStore
  reference: TopodMigrationCatalogReference
  signal?: AbortSignal
}): Promise<TopodMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedTopodMigrationCatalogByReference!(args.reference)
  await flushMigrationState(args.store, args.signal)
  // Either answer is flushed first, so a source that cannot re-send the manifest may act on it.
  return result.state === 'absent'
    ? { ...result, durableAbsent: true }
    : { ...result, durableCommitted: true }
}

export function getTopodMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getTopodMigrationCatalogState' | 'installTopodMigrationReceivedBlobs'>
  >
  manifest: TopodMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): TopodMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getTopodMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: TopodMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
