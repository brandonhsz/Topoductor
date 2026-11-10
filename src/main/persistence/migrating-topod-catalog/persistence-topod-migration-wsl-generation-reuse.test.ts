/**
 * R47: "Use on this computer again" can hand a later WSL move the generation number an earlier one
 * used. The host stages, commits and keeps receipts by migration id and manifest digest, so two
 * moves sharing a generation never collide; only the desktop's planner reads the generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import type { Repo } from '../../../shared/repo-types'
import { manifest } from './persistence-topod-migration-catalog-fixture'
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
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 1 }))
}))

const GENERATION = 3

function wslMove(migrationId: string, repoId: string): TopodMigrationManifest {
  const repo: Repo = {
    id: repoId,
    path: `/home/dev/${repoId}`,
    displayName: repoId,
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git'
  }
  return manifest({
    migrationId,
    source: {
      kind: 'local-wsl',
      distro: 'Ubuntu',
      scopeRepoIds: [repoId],
      scopeFolderWorkspaceIds: [],
      generation: GENERATION
    },
    payload: { repositories: [repo], projectGroups: [], folderWorkspaces: [] }
  })
}

describe('two WSL moves that share a generation number', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'topo-wsl-generation-reuse-'))
  })
  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('stage and commit independently, each under its own receipt', async () => {
    const store = createStore()
    const earlier = wslMove('move-earlier', 'repo-a')
    const later = wslMove('move-later', 'repo-b')
    expect(earlier.manifestSha256).not.toBe(later.manifestSha256)

    expect(store.stageTopodMigrationCatalog(earlier).state).toBe('staged')
    expect(store.stageTopodMigrationCatalog(later).state).toBe('staged')
    expect(store.commitStagedTopodMigrationCatalog(earlier)).toMatchObject({
      state: 'committed',
      receipt: { migrationId: 'move-earlier', repositoryIds: ['repo-a'] }
    })
    // The earlier commit neither committed nor dropped the later stage.
    expect(store.getTopodMigrationCatalogState(later).state).toBe('staged')
    expect(store.commitStagedTopodMigrationCatalog(later)).toMatchObject({
      state: 'committed',
      receipt: { migrationId: 'move-later', repositoryIds: ['repo-b'] }
    })
    await store.flushPendingOrThrowAsync()

    const restored = createStore()
    for (const move of [earlier, later]) {
      expect(restored.getTopodMigrationCatalogState(move)).toMatchObject({
        state: 'committed',
        migrationId: move.migrationId,
        manifestSha256: move.manifestSha256
      })
    }
    expect(
      restored
        .getRepos()
        .map((repo) => repo.id)
        .sort()
    ).toEqual(['repo-a', 'repo-b'])
  })

  it('abort one without touching the other', () => {
    const store = createStore()
    const earlier = wslMove('move-earlier', 'repo-a')
    const later = wslMove('move-later', 'repo-b')
    store.stageTopodMigrationCatalog(earlier)
    store.stageTopodMigrationCatalog(later)

    expect(store.abortStagedTopodMigrationCatalog(later)).toMatchObject({ aborted: true })
    expect(store.getTopodMigrationCatalogState(earlier).state).toBe('staged')
    expect(store.commitStagedTopodMigrationCatalog(earlier).state).toBe('committed')
    expect(store.getTopodMigrationCatalogState(later).state).toBe('absent')
  })
})
