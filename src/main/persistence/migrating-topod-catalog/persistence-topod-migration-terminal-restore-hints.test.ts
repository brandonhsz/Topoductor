import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TopodMigrationBlobDescriptor } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import { getTopodMigrationReceivedBlobPath } from './topod-migration-blob-staging'
import { commitStagedTopodMigrationCatalogDurably } from '../../runtime/hosts/migration/topod-migration-catalog-import'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import {
  DORMANT_LEAF_ID,
  DORMANT_WORKTREE_ID,
  FOLDER_WORKSPACE,
  dormantState,
  manifest as baseManifest
} from './persistence-topod-migration-catalog-fixture'
import { createStore, testState } from '../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

const FOLDER_LEAF_ID = '22222222-2222-4222-8222-222222222222'
const PANE = `tab-dormant:${DORMANT_LEAF_ID}`
const OTHER_PANE = `tab-folder:${FOLDER_LEAF_ID}`
const ABSENT_PANE = 'tab-absent:33333333-3333-4333-8333-333333333333'
const FOLDER_KEY = folderWorkspaceKey(FOLDER_WORKSPACE.id)

type Store = ReturnType<typeof createStore>

function manifest(): TopodMigrationManifest {
  const dormant = dormantState()
  const session = dormant.workspaceSession!
  dormant.workspaceSession = {
    ...session,
    tabsByWorktree: {
      ...session.tabsByWorktree,
      [FOLDER_KEY]: [
        {
          id: 'tab-folder',
          ptyId: null,
          worktreeId: FOLDER_KEY,
          title: 'Folder terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 8
        }
      ]
    },
    terminalLayoutsByTabId: {
      ...session.terminalLayoutsByTabId,
      'tab-folder': {
        root: { type: 'leaf', leafId: FOLDER_LEAF_ID },
        activeLeafId: FOLDER_LEAF_ID,
        expandedLeafId: null
      }
    }
  }
  const base = baseManifest()
  return baseManifest({ payload: { ...base.payload, dormantState: dormant } })
}

function peek(store: Store, paneKey: string, worktreeId: string): string | null {
  return store.peekTopodMigrationTerminalRestoreHint(paneKey, worktreeId)
}

function encodedHints(): {
  descriptor: TopodMigrationBlobDescriptor
  bytes: Buffer
} {
  // What an older desktop sends; this build installs it but no longer sends one.
  return rawBlob(
    Buffer.from(
      JSON.stringify({
        version: 1,
        hints: [
          { paneKey: PANE, cwd: '/home/me/src' },
          { paneKey: OTHER_PANE, cwd: '/srv/app' },
          { paneKey: ABSENT_PANE, cwd: '/srv/gone' }
        ]
      }),
      'utf8'
    )
  )
}

function rawBlob(bytes: Buffer): {
  descriptor: TopodMigrationBlobDescriptor
  bytes: Buffer
} {
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

function stageBlob(
  store: Store,
  input: TopodMigrationManifest,
  blob: { descriptor: TopodMigrationBlobDescriptor; bytes: Buffer }
): void {
  store.stageTopodMigrationCatalog(input)
  store.stageTopodMigrationBlobChunk({
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    blob: blob.descriptor,
    offset: 0,
    bytesBase64: blob.bytes.toString('base64')
  })
}

function receivedPath(input: TopodMigrationManifest): string {
  return getTopodMigrationReceivedBlobPath(join(testState.dir, 'topod-migration-blobs'), input, {
    blobKind: 'terminal-restore-hints',
    key: 'migration'
  })
}

async function commitDurably(store: Store, input: TopodMigrationManifest): Promise<string> {
  const result = await commitStagedTopodMigrationCatalogDurably({
    store,
    manifest: input,
    onDurableCommit: () => {}
  })
  return result.state
}

describe('topod migration terminal restore hints through the store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'topo-migration-restore-hints-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('installs hints scoped to their worktree after the durable commit, and survives store reload', async () => {
    const input = manifest()
    const store = createStore()
    stageBlob(store, input, encodedHints())

    expect(await commitDurably(store, input)).toBe('committed')
    expect(existsSync(receivedPath(input))).toBe(false)

    const restarted = createStore()
    expect(peek(restarted, PANE, DORMANT_WORKTREE_ID)).toBe('/home/me/src')
    expect(peek(restarted, PANE, FOLDER_KEY)).toBeNull()
    expect(peek(restarted, OTHER_PANE, FOLDER_KEY)).toBe('/srv/app')
    expect(peek(restarted, ABSENT_PANE, DORMANT_WORKTREE_ID)).toBeNull()
    restarted.consumeTopodMigrationTerminalRestoreHint(PANE)
    expect(peek(createStore(), PANE, DORMANT_WORKTREE_ID)).toBeNull()
    expect(peek(createStore(), OTHER_PANE, FOLDER_KEY)).toBe('/srv/app')
  })

  it('is idempotent across commit retries and never revives a consumed hint', async () => {
    const input = manifest()
    const store = createStore()
    const blob = encodedHints()
    stageBlob(store, input, blob)
    store.commitStagedTopodMigrationCatalog(input)
    await store.flushPendingOrThrowAsync()
    // Simulate a crash leaving an installed blob pending deletion.
    store.installTopodMigrationReceivedBlobs(input)
    expect(peek(store, PANE, DORMANT_WORKTREE_ID)).toBe('/home/me/src')
    store.consumeTopodMigrationTerminalRestoreHint(PANE)
    writeFileSync(receivedPath(input), blob.bytes)

    expect(await commitDurably(createStore(), input)).toBe('committed')
    expect(existsSync(receivedPath(input))).toBe(false)
    const restarted = createStore()
    expect(peek(restarted, PANE, DORMANT_WORKTREE_ID)).toBeNull()
    expect(peek(restarted, OTHER_PANE, FOLDER_KEY)).toBe('/srv/app')
  })

  it('drops a received file damaged after commit without failing the committed catalog', async () => {
    const input = manifest()
    const store = createStore()
    stageBlob(store, input, encodedHints())
    store.commitStagedTopodMigrationCatalog(input)
    await store.flushPendingOrThrowAsync()
    writeFileSync(receivedPath(input), 'not json')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await commitDurably(createStore(), input)).toBe('committed')
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('dropped unreadable terminal restore hints'),
      expect.any(Error)
    )
    expect(existsSync(receivedPath(input))).toBe(false)
    expect(peek(createStore(), PANE, DORMANT_WORKTREE_ID)).toBeNull()
    error.mockRestore()
  })
})
