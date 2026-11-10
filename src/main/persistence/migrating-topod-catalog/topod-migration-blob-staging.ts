// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  TOPOD_MIGRATION_BLOB_KINDS,
  assertTopodMigrationBlobSet,
  decodeTopodMigrationBlobChunk,
  topodMigrationBlobIdentity,
  parseTopodMigrationBlobDescriptor,
  sameTopodMigrationBlob,
  type TopodMigrationBlobChunkRequest,
  type TopodMigrationBlobChunkResult,
  type TopodMigrationBlobDescriptor,
  type TopodMigrationBlobKind,
  type TopodMigrationBlobUploadState
} from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import { syncDirectoryDurablySync } from '../../filesystem/durable-file-write'
import {
  appendTopodMigrationStagedChunk,
  ensureTopodMigrationDirectory,
  inspectTopodMigrationFinalFile,
  linkTopodMigrationStagedFile,
  topodMigrationFileMatches,
  topodMigrationStagedFileSize,
  topodMigrationStagingDirectory,
  topodMigrationStagingKey,
  pruneTopodMigrationKeyedDirectories,
  pruneTopodMigrationStagingDirectories,
  removeTopodMigrationStagingDirectory,
  requireStagedTopodMigrationManifest,
  type TopodMigrationRequestIdentity
} from './topod-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type TopodMigrationBlobName = Pick<TopodMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: TopodMigrationRequestIdentity,
  descriptor: TopodMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<TopodMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath,
  'terminal-history': receivedDirectoryPath,
  'automation-run-history': receivedDirectoryPath
}

export function getTopodMigrationReceivedBlobPath(
  root: string,
  manifest: TopodMigrationRequestIdentity,
  descriptor: TopodMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listTopodMigrationReceivedBlobNames(
  root: string,
  manifest: TopodMigrationRequestIdentity,
  blobKind: TopodMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type TopodMigrationBlobChunkStaging = {
  stagedManifest: TopodMigrationManifest | null
  root: string
  request: TopodMigrationBlobChunkRequest
}

export function stageTopodMigrationBlobChunk(
  args: TopodMigrationBlobChunkStaging
): TopodMigrationBlobChunkResult {
  const manifest = requireStagedTopodMigrationManifest(
    args.stagedManifest,
    args.request,
    'topod_migration_blob_catalog_not_staged'
  )
  const descriptor = parseTopodMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeTopodMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => topodMigrationBlobIdentity(entry) === topodMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameTopodMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`topod_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertTopodMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureTopodMigrationDirectory(dirname(path))
  const receivedBytes = appendTopodMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectTopodMigrationBlobUploads(
  manifest: TopodMigrationManifest,
  root: string
): TopodMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : topodMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertTopodMigrationBlobsReady(
  manifest: TopodMigrationManifest,
  root: string
): void {
  for (const upload of inspectTopodMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`topod_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`topod_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !topodMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`topod_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertTopodMigrationBlobsReady in the same synchronous turn. */
export function stagedTopodMigrationBlobFiles(
  manifest: TopodMigrationManifest,
  root: string
): { descriptor: TopodMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** A blob's verified bytes, staged or already moved to received by an earlier commit attempt. */
export function readTopodMigrationBlob(
  manifest: TopodMigrationManifest,
  root: string,
  descriptor: TopodMigrationBlobDescriptor
): Buffer {
  for (const path of [
    stagedBlobPath(root, manifest, descriptor),
    getTopodMigrationReceivedBlobPath(root, manifest, descriptor)
  ]) {
    if (topodMigrationFileMatches(path, descriptor)) {
      return readFileSync(path)
    }
  }
  throw new Error(`topod_migration_blob_incomplete:${descriptor.blobKind}:${descriptor.key}`)
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertTopodMigrationBlobSetMatches(
  manifest: TopodMigrationManifest,
  root: string,
  expected: readonly TopodMigrationBlobDescriptor[]
): void {
  assertTopodMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [topodMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(topodMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(topodMigrationBlobIdentity(descriptor))
    if (!match || !sameTopodMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('topod_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(topodMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertTopodMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitTopodMigrationBlobs(manifest: TopodMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getTopodMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureTopodMigrationDirectory(dirname(finalPath))
    linkTopodMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `topod_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeTopodMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortTopodMigrationBlobs(manifest: TopodMigrationManifest, root: string): void {
  removeTopodMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneTopodMigrationBlobStaging(
  stagedManifests: readonly TopodMigrationManifest[],
  committedMigrations: readonly TopodMigrationRequestIdentity[],
  root: string
): void {
  pruneTopodMigrationStagingDirectories(root, stagedManifests)
  pruneTopodMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: TopodMigrationBlobDescriptor): Error {
  return new Error(`topod_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: TopodMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return TOPOD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      topodMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: TopodMigrationManifest
): TopodMigrationBlobDescriptor[] {
  const staging = topodMigrationStagingDirectory(root, manifest)
  const descriptors: TopodMigrationBlobDescriptor[] = []
  for (const blobKind of TOPOD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseTopodMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: TopodMigrationManifest,
  descriptor: TopodMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectTopodMigrationFinalFile(
    getTopodMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: TopodMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, topodMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: TopodMigrationManifest,
  descriptor: TopodMigrationBlobDescriptor
): string {
  return join(
    topodMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
