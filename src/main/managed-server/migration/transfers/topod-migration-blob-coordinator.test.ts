import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TOPOD_MIGRATION_BLOB_CHUNK_BYTES,
  requiredMigrationBlobCapabilities,
  type TopodMigrationBlobDescriptor
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/topod-migration/topod-migration-manifest-validation'
import type {
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import { TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../../../../shared/topod-runtime-capabilities'
import {
  inspectTopodMigrationBlobUploads,
  stageTopodMigrationBlobChunk
} from '../../../persistence/migrating-topod-catalog/topod-migration-blob-staging'
import {
  transferTopodMigrationBlobs,
  type TopodMigrationBlobDestination
} from './topod-migration-blob-coordinator'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'topod-migration-blob-sender-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const manifest: TopodMigrationManifest = {
  version: TOPOD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
  manifestSha256: 'a'.repeat(64)
}

const history = Buffer.alloc(TOPOD_MIGRATION_BLOB_CHUNK_BYTES * 2 + 17, 0x61)
const hints = Buffer.from('{"panes":[]}')
const blobs = [
  descriptor('shell-history', `${'a'.repeat(16)}-zsh`, history),
  descriptor('terminal-restore-hints', 'migration', hints)
]
const contents = new Map([
  [blobs[0].key, history],
  [blobs[1].key, hints]
])

describe('topod migration blob sender', () => {
  it.each([
    ['the blob channel', [blobs[1]], ['topod.migration-blob.terminal-restore-hints.v1']],
    ["the blob's kind", [blobs[1]], [TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY]]
  ])('refuses before staging anything when the destination lacks %s', async (_, sent, caps) => {
    const destination = realDestination(caps)

    await expect(
      transferTopodMigrationBlobs({ source: source(), manifest, blobs: sent, destination })
    ).rejects.toThrow(/^topod_migration_destination_blob_kind_unsupported:terminal-restore-hints:/)
    expect(destination.readState).not.toHaveBeenCalled()
    expect(destination.stageChunk).not.toHaveBeenCalled()
    expect(inspectTopodMigrationBlobUploads(manifest, root)).toBeUndefined()
  })

  it('refuses when the destination holds the same key with other bytes', async () => {
    const stale = descriptor('terminal-restore-hints', 'migration', Buffer.from('stale'))
    stageTopodMigrationBlobChunk({
      stagedManifest: manifest,
      root,
      request: chunkRequest(stale, 0, Buffer.from('st'))
    })
    const destination = realDestination(requiredMigrationBlobCapabilities(blobs))

    await expect(
      transferTopodMigrationBlobs({ source: source(), manifest, blobs, destination })
    ).rejects.toThrow('topod_migration_blob_descriptor_conflict:terminal-restore-hints')
    expect(destination.stageChunk).not.toHaveBeenCalled()
  })
})

function descriptor(
  blobKind: TopodMigrationBlobDescriptor['blobKind'],
  key: string,
  bytes: Buffer
): TopodMigrationBlobDescriptor {
  return {
    blobKind,
    key,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
}

function chunkRequest(blob: TopodMigrationBlobDescriptor, offset: number, bytes: Buffer) {
  return {
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    blob,
    offset,
    bytesBase64: bytes.toString('base64')
  }
}

function source() {
  return {
    readChunk: async (blob: TopodMigrationBlobDescriptor, offset: number, maxBytes: number) =>
      (contents.get(blob.key) ?? Buffer.alloc(0)).subarray(offset, offset + maxBytes)
  }
}

/** Use real staging semantics so resume observes host-equivalent state. */
function realDestination(capabilities: readonly string[]) {
  const readState = async (): Promise<TopodMigrationCatalogState> => {
    const blobUploads = inspectTopodMigrationBlobUploads(manifest, root)
    return {
      state: 'staged',
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      stagedAt: '2026-08-30T12:01:00.000Z',
      ...(blobUploads ? { blobUploads } : {})
    }
  }
  const destination = {
    readCapabilities: vi.fn<TopodMigrationBlobDestination['readCapabilities']>(
      async () => capabilities
    ),
    readState: vi.fn<TopodMigrationBlobDestination['readState']>(readState),
    stageChunk: vi.fn<TopodMigrationBlobDestination['stageChunk']>(async (request) =>
      stageTopodMigrationBlobChunk({ stagedManifest: manifest, root, request })
    )
  }
  return destination
}
