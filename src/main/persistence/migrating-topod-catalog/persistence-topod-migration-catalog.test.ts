import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DORMANT_AUTOMATION,
  DORMANT_WORKTREE_ID,
  REPOSITORY,
  dormantState,
  manifest
} from './persistence-topod-migration-catalog-fixture'
import { createStore, readDataFile, testState, writeDataFile } from '../persistence-test-harness'
import { hostWorktreeTarget } from '../../../shared/worktree/host-qualified-identity'

const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn(() => ({ nth_repo_added: 1 }))
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../../telemetry/client', () => ({ track: trackMock }))
vi.mock('../../telemetry/cohort-classifier', () => ({ getCohortAtEmit: getCohortAtEmitMock }))

function commitCatalog(
  store: ReturnType<typeof createStore>,
  input: ReturnType<typeof manifest>,
  options?: { now?: () => Date }
) {
  store.stageTopodMigrationCatalog(input, options)
  return store.commitStagedTopodMigrationCatalog(input, options)
}

describe('topod migration catalog persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'topo-migration-catalog-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  // Two desktops on one host each carry their own focus; the second must not be refused for it.

  it('stages durably without publishing rows, then commits catalog and receipt together', async () => {
    const store = createStore()
    const input = manifest()

    expect(
      store.stageTopodMigrationCatalog(input, {
        now: () => new Date('2026-08-30T12:03:00.000Z')
      })
    ).toEqual({
      state: 'staged',
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      stagedAt: '2026-08-30T12:03:00.000Z'
    })
    expect(store.getRepos()).toEqual([])
    await store.flushPendingOrThrowAsync()

    const restored = createStore()
    expect(restored.getTopodMigrationCatalogState(input)).toMatchObject({ state: 'staged' })
    expect(
      restored.commitStagedTopodMigrationCatalog(input, {
        now: () => new Date('2026-08-30T12:05:00.000Z')
      })
    ).toMatchObject({ state: 'committed', receipt: { importedAt: '2026-08-30T12:05:00.000Z' } })
    expect(restored.getRepos()).toHaveLength(1)
    await restored.flushPendingOrThrowAsync()

    const committed = createStore()
    expect(committed.getTopodMigrationCatalogState(input)).toMatchObject({
      state: 'committed',
      receipt: { repositoryIds: ['repo-1'] }
    })
    expect(readDataFile()).not.toHaveProperty('topodMigrationStagedCatalogs.0')
  })

  it('recovers a dormant commit lost before flush from the durable stage', async () => {
    const store = createStore()
    const base = manifest()
    const input = manifest({ payload: { ...base.payload, dormantState: dormantState() } })
    store.stageTopodMigrationCatalog(input)
    await store.flushPendingOrThrowAsync()
    const stagedDiskState = readDataFile()

    store.commitStagedTopodMigrationCatalog(input)
    expect(store.getWorktreeMeta(DORMANT_WORKTREE_ID)?.comment).toBe('Preserve me')
    writeDataFile(stagedDiskState)

    const restored = createStore()
    expect(restored.getTopodMigrationCatalogState(input)).toMatchObject({ state: 'staged' })
    expect(restored.getWorktreeMeta(DORMANT_WORKTREE_ID)).toBeUndefined()
    restored.commitStagedTopodMigrationCatalog(input)
    await restored.flushPendingOrThrowAsync()

    const committed = createStore()
    expect(committed.getTopodMigrationCatalogState(input)).toMatchObject({ state: 'committed' })
    expect(committed.getWorktreeMeta(DORMANT_WORKTREE_ID)?.comment).toBe('Preserve me')
  })

  it('rejects dormant-state conflicts before publishing any catalog row', () => {
    const store = createStore()
    store.setWorktreeMeta(hostWorktreeTarget({ id: DORMANT_WORKTREE_ID, hostId: 'local' }), {
      ...dormantState().worktreeMeta[0].meta,
      comment: 'Different owner'
    })
    const base = manifest()
    const input = manifest({ payload: { ...base.payload, dormantState: dormantState() } })

    expect(() => store.stageTopodMigrationCatalog(input)).toThrow(
      `topod_migration_dormant_id_conflict:worktree_meta:${DORMANT_WORKTREE_ID}`
    )
    expect(store.getRepos()).toEqual([])
    expect(store.getProjectGroups()).toEqual([])
    expect(store.getFolderWorkspaces()).toEqual([])
  })

  it('rejects destination automation state with an in-flight run', () => {
    const store = createStore()
    const base = manifest()
    const first = manifest({ payload: { ...base.payload, dormantState: dormantState() } })
    commitCatalog(store, first)
    store.createAutomationRun(DORMANT_AUTOMATION, 10, 'manual')
    const nextDormant = dormantState()
    delete nextDormant.automationRuns
    const second = manifest({
      migrationId: 'migration-automation-active',
      payload: { ...base.payload, dormantState: nextDormant }
    })

    expect(() => store.stageTopodMigrationCatalog(second)).toThrow(
      `topod_migration_dormant_automation_run_active:${DORMANT_AUTOMATION.id}`
    )
    expect(store.getTopodMigrationCatalogState(second)).toMatchObject({ state: 'absent' })
  })

  it('retains exclusive staged claims after reload and releases them on dormant abort', async () => {
    const store = createStore()
    const first = manifest()
    const second = manifest({ migrationId: 'competing-migration' })
    store.stageTopodMigrationCatalog(first)
    await store.flushPendingOrThrowAsync()
    const restored = createStore()
    expect(() => restored.stageTopodMigrationCatalog(second)).toThrow(
      'topod_migration_staged_claim_conflict:'
    )
    expect(restored.getTopodMigrationCatalogState(first)).toMatchObject({ state: 'staged' })
    expect(restored.getTopodMigrationCatalogState(second)).toMatchObject({ state: 'absent' })
    expect(restored.getRepos()).toEqual([])
    expect(restored.abortStagedTopodMigrationCatalog(first).aborted).toBe(true)
    await restored.flushPendingOrThrowAsync()
    const afterAbort = createStore()
    expect(afterAbort.stageTopodMigrationCatalog(second)).toMatchObject({ state: 'staged' })
    expect(afterAbort.commitStagedTopodMigrationCatalog(second)).toMatchObject({
      state: 'committed'
    })
  })

  it('refuses committing overlapping stages loaded from an older writer', async () => {
    const store = createStore()
    const first = manifest()
    const second = manifest({ migrationId: 'older-competing-stage' })
    store.stageTopodMigrationCatalog(first)
    await store.flushPendingOrThrowAsync()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the raw data file is untyped JSON this test edits to simulate an older writer.
    const persisted = readDataFile() as Record<string, unknown>
    persisted.topodMigrationStagedCatalogs = [first, second].map((entry) => ({
      version: 1,
      manifest: entry,
      stagedAt: entry.createdAt
    }))
    writeDataFile(persisted)
    const restored = createStore()
    for (const entry of [first, second]) {
      expect(() => restored.commitStagedTopodMigrationCatalog(entry)).toThrow(
        'topod_migration_staged_claim_conflict:'
      )
      expect(restored.getTopodMigrationCatalogState(entry)).toMatchObject({ state: 'staged' })
    }
    expect(restored.getRepos()).toEqual([])
    expect(restored.abortStagedTopodMigrationCatalog(second).aborted).toBe(true)
    expect(restored.commitStagedTopodMigrationCatalog(first)).toMatchObject({ state: 'committed' })
  })

  it('still reads a commit as committed after the live server changed what it imported', () => {
    const store = createStore()
    const input = manifest()
    commitCatalog(store, input)
    store.removeProjectForHost({ id: REPOSITORY.id, executionHostId: 'local' })

    expect(store.getTopodMigrationCatalogState(input).state).toBe('committed')
    expect(store.getRepos()).toEqual([])
  })
})
