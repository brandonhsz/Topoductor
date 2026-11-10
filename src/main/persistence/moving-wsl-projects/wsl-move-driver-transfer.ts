/**
 * The host half of a WSL move, from `quiesced` to `destination-committed`: stage the catalog, send
 * the scrollback snapshots and blobs, then ask for the commit. Each step is journaled before the
 * next starts, and the commit is requested only from `blobs-transferred` (#29825's contract).
 */
import type { TopodMigrationBlobDescriptor } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationCatalogState } from '../../../shared/topod-migration/topod-migration-manifest'
import type { WslMoveCutover, WslMoveCutoverPhase } from '../../../shared/wsl-move/wsl-move-cutover'
import {
  transferTopodMigrationBlobs,
  type TopodMigrationBlobSource
} from '../../managed-server/migration/transfers/topod-migration-blob-coordinator'
import { resolveDurableTopodCatalogMutation } from '../../managed-server/migration/cutover/topod-catalog-durable-mutation'
import { transferTopodMigrationSnapshots } from '../../managed-server/migration/transfers/topod-migration-snapshot-coordinator'
import { writeWslMoveCutover } from './wsl-move-cutover-journal'
import type { WslMoveDriverDeps, WslMoveHost, WslMoveManifestExport } from './wsl-move-driver-ports'
import { assertWslMoveCommitRequestAllowed } from './wsl-move-reset'
import {
  wslMoveTerminalHistoryBlobs,
  type WslMoveSleptScrollback
} from './wsl-move-slept-scrollback'

type TransferDeps = Pick<WslMoveDriverDeps, 'userDataPath' | 'snapshots' | 'shellHistory' | 'now'>

/** One phase forward through the journal's compare-and-swap; durable before it returns. */
export function advanceWslMove(
  deps: Pick<WslMoveDriverDeps, 'userDataPath' | 'now'>,
  cutover: WslMoveCutover,
  phase: WslMoveCutoverPhase
): WslMoveCutover {
  const next: WslMoveCutover = { ...cutover, phase, updatedAt: deps.now().toISOString() }
  writeWslMoveCutover(deps.userDataPath, next)
  return next
}

/** The move's bytes as progress shows them: the terminal history sent while staging, then the blobs. */
export function wslMoveCopyBytes(
  quiesced: Pick<WslMoveCutover, 'manifest'>,
  blobs: readonly Pick<TopodMigrationBlobDescriptor, 'byteLength'>[]
): { snapshotBytes: number; bytesTotal: number } {
  const snapshots = quiesced.manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  const snapshotBytes = snapshots.reduce((sum, snapshot) => sum + snapshot.byteLength, 0)
  return {
    snapshotBytes,
    bytesTotal: snapshotBytes + blobs.reduce((sum, blob) => sum + blob.byteLength, 0)
  }
}

export async function stageWslMove(
  deps: TransferDeps,
  host: WslMoveHost,
  quiesced: WslMoveCutover
): Promise<WslMoveCutover> {
  const { catalog } = host
  const state = await resolveDurableTopodCatalogMutation(
    () => catalog.stage(quiesced.manifest),
    () => catalog.readState(quiesced.manifest),
    (observed) => observed.state !== 'absent'
  )
  // Nothing asked for a commit yet, so anything but a stage of this manifest is not ours.
  if (state.state !== 'staged') {
    throw new Error(`wsl_move_stage_not_staged:${state.state}`)
  }
  assertSameMigration(quiesced, state)
  const staged = advanceWslMove(deps, quiesced, 'destination-staged')
  await transferTopodMigrationSnapshots({
    source: deps.snapshots,
    manifest: staged.manifest,
    state,
    destination: { readState: catalog.readState, stageChunk: catalog.stageChunk }
  })
  return staged
}

/** Each pane's own checkpoint (history and folder) as a blob, plus the shells' history files. */
export async function collectWslMoveBlobs(
  deps: TransferDeps,
  cutover: WslMoveCutover,
  worktrees: WslMoveManifestExport['worktrees'],
  slept: WslMoveSleptScrollback
): Promise<{ descriptors: TopodMigrationBlobDescriptor[]; source: TopodMigrationBlobSource }> {
  const panes = wslMoveTerminalHistoryBlobs(slept, cutover.manifest)
  const history = await deps.shellHistory(cutover.manifest.source.distro, worktrees)
  const descriptors = [...panes.descriptors, ...history.descriptors]
  return {
    descriptors,
    source: {
      readChunk: (descriptor, offset, maxBytes) =>
        descriptor.blobKind === 'terminal-history'
          ? panes.source.readChunk(descriptor, offset, maxBytes)
          : history.source.readChunk(descriptor, offset, maxBytes)
    }
  }
}

/** Sends every blob; the caller journals `blobs-transferred` once the terminals are proven again. */
export async function sendWslMoveBlobs(
  host: WslMoveHost,
  staged: WslMoveCutover,
  blobs: Awaited<ReturnType<typeof collectWslMoveBlobs>>
): Promise<void> {
  await transferTopodMigrationBlobs({
    source: blobs.source,
    manifest: staged.manifest,
    blobs: blobs.descriptors,
    destination: {
      readCapabilities: async () => host.capabilities,
      readState: host.catalog.readState,
      stageChunk: host.blobs.stageChunk
    }
  })
}

/**
 * Only an acknowledged commit moves the journal. A lost reply throws: the caller's reset asks the
 * host, and records the commit from its acknowledgement if it landed.
 */
export async function commitWslMove(
  deps: TransferDeps,
  host: WslMoveHost,
  transferred: WslMoveCutover,
  expectedBlobs: readonly TopodMigrationBlobDescriptor[]
): Promise<WslMoveCutover> {
  assertWslMoveCommitRequestAllowed(transferred)
  const state = await host.commitWithBlobs(transferred.manifest, expectedBlobs)
  if (state.state !== 'committed') {
    throw new Error(`wsl_move_commit_not_committed:${state.state}`)
  }
  assertSameMigration(transferred, state)
  if (
    state.receipt.migrationId !== transferred.migrationId ||
    state.receipt.manifestSha256 !== transferred.manifestSha256
  ) {
    throw new Error('wsl_move_destination_receipt_mismatch')
  }
  return advanceWslMove(deps, transferred, 'destination-committed')
}

function assertSameMigration(cutover: WslMoveCutover, state: TopodMigrationCatalogState): void {
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('wsl_move_destination_state_mismatch')
  }
}
