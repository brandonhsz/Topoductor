import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TOPOD_MIGRATION_BLOB_CHUNK_BYTES,
  type TopodMigrationBlobDescriptor
} from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import { getTopodMigrationReceivedBlobPath } from './topod-migration-blob-staging'
import {
  commitStagedTopodMigrationCatalogDurably,
  getTopodMigrationCatalogState
} from '../../runtime/hosts/migration/topod-migration-catalog-import'
import {
  DORMANT_LEAF_ID,
  DORMANT_WORKTREE_ID,
  dormantState,
  manifest
} from './persistence-topod-migration-catalog-fixture'
import { createStore, readDataFile, testState, writeDataFile } from '../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

type Store = ReturnType<typeof createStore>

const HINTED_PANE = `tab-dormant:${DORMANT_LEAF_ID}`
const noLiveShells = (): boolean => false

function encodeHints(cwd: string): { bytes: Buffer; descriptor: TopodMigrationBlobDescriptor } {
  const bytes = Buffer.from(JSON.stringify({ version: 1, hints: [{ paneKey: HINTED_PANE, cwd }] }))
  return {
    bytes,
    descriptor: {
      blobKind: 'terminal-restore-hints',
      key: 'migration',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length
    }
  }
}

function receivedHintsPath(input: TopodMigrationManifest): string {
  return getTopodMigrationReceivedBlobPath(join(testState.dir, 'topod-migration-blobs'), input, {
    blobKind: 'terminal-restore-hints',
    key: 'migration'
  })
}

function hint(store: Store): string | null {
  return store.peekTopodMigrationTerminalRestoreHint(HINTED_PANE, DORMANT_WORKTREE_ID)
}

function commitDurably(store: Store, input: TopodMigrationManifest) {
  return commitStagedTopodMigrationCatalogDurably({
    store,
    manifest: input,
    onDurableCommit: () => {}
  })
}

async function stageHints(store: Store) {
  const hints = encodeHints('/home/me/src')
  const base = manifest()
  const input = manifest({ payload: { ...base.payload, dormantState: dormantState() } })
  store.stageTopodMigrationCatalog(input)
  for (let offset = 0; offset < hints.bytes.length; offset += TOPOD_MIGRATION_BLOB_CHUNK_BYTES) {
    store.stageTopodMigrationBlobChunk({
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      blob: hints.descriptor,
      offset,
      bytesBase64: hints.bytes
        .subarray(offset, offset + TOPOD_MIGRATION_BLOB_CHUNK_BYTES)
        .toString('base64')
    })
  }
  await store.flushPendingOrThrowAsync()
  return { input, expectedBlobs: [hints.descriptor], stagedDisk: readDataFile() }
}

async function commitWithFailedFlush(store: Store, input: TopodMigrationManifest) {
  vi.spyOn(store, 'flushPendingOrThrowAsync').mockRejectedValueOnce(new Error('disk full'))
  await expect(commitDurably(store, input)).rejects.toThrow('disk full')
}

describe('topod migration received blobs wait for a durable commit', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'topo-migration-blobs-durable-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('keeps the received blob through a failed flush and state query, for retry after reloading the stage', async () => {
    const store = createStore()
    const { input, expectedBlobs, stagedDisk } = await stageHints(store)
    await commitWithFailedFlush(store, input)

    // An in-memory commit receipt cannot authorize consuming blobs before durability.
    expect(getTopodMigrationCatalogState({ store, manifest: input }).state).toBe('committed')
    expect(existsSync(receivedHintsPath(input))).toBe(true)
    expect(hint(store)).toBeNull()

    writeDataFile(stagedDisk)
    const restarted = createStore()
    expect(restarted.getTopodMigrationCatalogState(input).state).toBe('staged')
    const result = await commitStagedTopodMigrationCatalogDurably({
      store: restarted,
      manifest: input,
      expectedBlobs,
      onDurableCommit: () => {}
    })
    expect(result.state).toBe('committed')
    expect(hint(restarted)).toBe('/home/me/src')
    expect(existsSync(receivedHintsPath(input))).toBe(false)
  })

  it('never consumes an in-memory-only commit in the post-attach pass', async () => {
    const store = createStore()
    const { input } = await stageHints(store)
    await commitWithFailedFlush(store, input)

    store.installPendingTopodMigrationReceivedBlobs({ worktreeHasLiveShells: noLiveShells })
    store.installDeferredTopodMigrationShellHistory(DORMANT_WORKTREE_ID, {
      worktreeHasLiveShells: noLiveShells
    })
    expect(existsSync(receivedHintsPath(input))).toBe(true)
  })

  it('installs the blob when a same-process retry flushes the commit', async () => {
    const store = createStore()
    const { input, expectedBlobs } = await stageHints(store)
    await commitWithFailedFlush(store, input)

    const retried = await commitStagedTopodMigrationCatalogDurably({
      store,
      manifest: input,
      expectedBlobs,
      onDurableCommit: () => {}
    })
    expect(retried.state).toBe('committed')
    expect(existsSync(receivedHintsPath(input))).toBe(false)
    expect(hint(store)).toBe('/home/me/src')
  })
})
