/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
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
  TopodMigrationBlobChunkResult
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import type {
  TopodMigrationSourceCutover,
  TopodMigrationSourceCutoverPhase
} from '../../../../shared/topod-migration/topod-migration-source-cutover'
import { resolveDurableTopodCatalogMutation } from './topod-catalog-durable-mutation'
import { TOPOD_MIGRATION_DESTINATION_UNSUPPORTED } from '../catalog/topod-migration-request'
import { topodMigrationRequestFits } from '../catalog/topod-migration-request-budget'
import {
  listTopodMigrationSourceCutovers,
  writeTopodMigrationSourceCutover
} from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import type { TopodMigrationSourceCutoverPort } from './topod-migration-source'
import {
  transferTopodMigrationSnapshots,
  type TopodMigrationSnapshotSource
} from '../transfers/topod-migration-snapshot-coordinator'
import {
  exportedTopodMigrationBlobSource,
  transferTopodMigrationBlobs
} from '../transfers/topod-migration-blob-coordinator'
import type { TopodMigrationExportedBlob } from '../../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import type { TopodMigrationPreflightStore } from '../../../ssh/targets/ssh-target-topod-preflight'
import { sshRelayMigrationCutoverPort } from '../../../ssh/migration-source/topod-migration-ssh-relay-source'
import type { SshTargetTopodClaims } from '../../../ssh/targets/ssh-target-topod-claims'

export type TopodMigrationDestinationCatalog = {
  readState: (manifest: TopodMigrationManifest) => Promise<TopodMigrationCatalogState>
  stage: (manifest: TopodMigrationManifest) => Promise<TopodMigrationCatalogState>
  commit: (manifest: TopodMigrationManifest) => Promise<TopodMigrationCatalogState>
  abort: (manifest: TopodMigrationManifest) => Promise<TopodMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: TopodMigrationCatalogReference
  ) => Promise<TopodMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: TopodMigrationSnapshotChunkRequest
  ) => Promise<TopodMigrationSnapshotChunkResult>
  /** Read fresh before blobs are sent: each blob kind needs its own capability. */
  readCapabilities: () => Promise<readonly string[]>
  stageBlobChunk: (
    request: TopodMigrationBlobChunkRequest
  ) => Promise<TopodMigrationBlobChunkResult>
}

export type TopodMigrationCutoverContext = {
  userDataPath: string
  store: TopodMigrationPreflightStore & TopodMigrationSnapshotSource
  claims: SshTargetTopodClaims
  destination: TopodMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => TopodMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: TopodMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: TopodMigrationCutoverContext): TopodMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageTopodMigrationDestination(
  context: TopodMigrationCutoverContext,
  migrationId: string
): Promise<TopodMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  const blobs = assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableTopodCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferTopodMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
    await transferTopodMigrationBlobs({
      source: exportedTopodMigrationBlobSource(blobs),
      manifest: cutover.manifest,
      blobs: blobs.map((blob) => blob.descriptor),
      destination: {
        readCapabilities: destination.readCapabilities,
        readState: destination.readState,
        stageChunk: destination.stageBlobChunk
      }
    })
  }
  return cutover
}

export async function commitTopodMigrationDestination(
  context: TopodMigrationCutoverContext,
  migrationId: string
): Promise<TopodMigrationSourceCutover> {
  const staged = await stageTopodMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableTopodCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`topod_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type TopodMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortTopodMigrationCutover(
  context: TopodMigrationCutoverContext,
  migrationId: string,
  release: (cutover: TopodMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<TopodMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!topodMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: TopodMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`topod_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
export async function confirmDurableCommit(
  destination: TopodMigrationDestinationCatalog,
  manifest: TopodMigrationManifest
): Promise<TopodMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`topod_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: TopodMigrationCutoverContext,
  cutover: TopodMigrationSourceCutover
): TopodMigrationExportedBlob[] {
  return cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: TopodMigrationCutoverContext,
  cutover: TopodMigrationSourceCutover,
  state: TopodMigrationCatalogState
): TopodMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('topod_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('topod_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('topod_migration_destination_receipt_mismatch')
  }
  const phase: TopodMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: TopodMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeTopodMigrationSourceCutover(context.userDataPath, next)
  return next
}

/** Aborts staging; a failed abort is decided by a re-read, never assumed. */
export async function abortWithRecovery(
  destination: TopodMigrationDestinationCatalog,
  manifest: TopodMigrationManifest
): Promise<TopodMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): TopodMigrationSourceCutover {
  const cutover = listTopodMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('topod_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): TopodMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'topod_migration_committed_source_cannot_be_released',
    reason: 'This host’s Topo server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === TOPOD_MIGRATION_DESTINATION_UNSUPPORTED
}
