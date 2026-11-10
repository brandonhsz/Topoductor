/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  TOPOD_MIGRATION_BLOB_CHUNK_BYTES,
  type TopodMigrationBlobChunkRequest,
  type TopodMigrationBlobChunkResult,
  type TopodMigrationBlobDescriptor,
  assertTopodMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  topodMigrationBlobIdentity,
  topodMigrationBlobKindUnsupportedBlocker,
  sameTopodMigrationBlob
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import type {
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'

export type TopodMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: TopodMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type TopodMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: TopodMigrationManifest) => Promise<TopodMigrationCatalogState>
  stageChunk: (request: TopodMigrationBlobChunkRequest) => Promise<TopodMigrationBlobChunkResult>
}

/** Serve exported bytes, refusing any descriptor they were not exported as. */
export function exportedTopodMigrationBlobSource(
  blobs: readonly { descriptor: TopodMigrationBlobDescriptor; bytes: Buffer }[]
): TopodMigrationBlobSource {
  return {
    readChunk: async (descriptor, offset, maxBytes) => {
      const blob = blobs.find((entry) => sameTopodMigrationBlob(entry.descriptor, descriptor))
      if (!blob) {
        throw new Error(`topod_migration_source_blob_changed:${descriptor.blobKind}`)
      }
      return blob.bytes.subarray(offset, offset + maxBytes)
    }
  }
}

type TopodMigrationBlobTransfer = {
  source: TopodMigrationBlobSource
  manifest: TopodMigrationManifest
  blobs: readonly TopodMigrationBlobDescriptor[]
  destination: TopodMigrationBlobDestination
}

type StagedCatalogState = Extract<TopodMigrationCatalogState, { state: 'staged' }>

export async function transferTopodMigrationBlobs(
  transfer: TopodMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertTopodMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(topodMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(topodMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(TOPOD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > TOPOD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`topod_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: TopodMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: TopodMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('topod_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: TopodMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [topodMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(topodMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameTopodMigrationBlob(blob, upload)) {
      throw new Error(`topod_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(topodMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: TopodMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(topodMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`topod_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: TopodMigrationBlobTransfer,
  request: TopodMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('topod_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                topodMigrationBlobIdentity(entry) === topodMigrationBlobIdentity(request.blob)
            )?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
