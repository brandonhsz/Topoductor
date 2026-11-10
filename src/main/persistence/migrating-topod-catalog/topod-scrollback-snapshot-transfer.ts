import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import {
  decodeTopodMigrationSnapshotChunk,
  type TopodMigrationSnapshotChunkRequest,
  type TopodMigrationSnapshotChunkResult,
  type TopodMigrationSnapshotUploadState,
  type TopodMigrationTerminalScrollbackSnapshot
} from '../../../shared/topod-migration/topod-migration-scrollback'
import { syncDirectoryDurablySync } from '../../filesystem/durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../pty/scrollback/terminal-scrollback-snapshots'
import {
  appendTopodMigrationStagedChunk,
  ensureTopodMigrationDirectory,
  inspectTopodMigrationFinalFile,
  linkTopodMigrationStagedFile,
  topodMigrationFileMatches,
  topodMigrationStagedFileSize,
  topodMigrationStagingDirectory,
  pruneTopodMigrationStagingDirectories,
  removeTopodMigrationStagingDirectory,
  requireStagedTopodMigrationManifest
} from './topod-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageTopodMigrationSnapshotChunk(args: {
  stagedManifest: TopodMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: TopodMigrationSnapshotChunkRequest
}): TopodMigrationSnapshotChunkResult {
  const manifest = requireStagedTopodMigrationManifest(
    args.stagedManifest,
    args.request,
    'topod_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeTopodMigrationSnapshotChunk(args.request.bytesBase64)
  ensureTopodMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendTopodMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectTopodMigrationSnapshotUploads(
  manifest: TopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): TopodMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : topodMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertTopodMigrationSnapshotsReady(
  manifest: TopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectTopodMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`topod_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`topod_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !topodMigrationFileMatches(path, upload)) {
      throw new Error(`topod_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitTopodMigrationSnapshots(
  manifest: TopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertTopodMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('topod_migration_snapshot_ref_invalid')
    }
    linkTopodMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `topod_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeTopodMigrationStagingDirectory(root, manifest)
}

export function abortTopodMigrationSnapshots(
  manifest: TopodMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeTopodMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneTopodMigrationSnapshotStaging(
  stagedManifests: readonly TopodMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneTopodMigrationStagingDirectories(getTerminalScrollbackSnapshotRoot(storage), stagedManifests)
}

function requireDescriptor(
  manifest: TopodMigrationManifest,
  ref: string
): TopodMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('topod_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: TopodMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectTopodMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: TopodMigrationManifest
): string {
  return topodMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: TopodMigrationManifest,
  descriptor: TopodMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
