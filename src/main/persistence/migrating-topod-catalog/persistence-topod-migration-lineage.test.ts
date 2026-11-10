import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultPersistedState } from '../../../shared/constants'
import type {
  TopodMigrationDormantStatePayload,
  TopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest'
import type {
  CrossStoreWorkspaceLineage,
  WorkspaceLineage,
  WorktreeLineage
} from '../../../shared/worktree/lineage-types'
import { parseTopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest-validation'
import { manifest } from './persistence-topod-migration-catalog-fixture'
import { createStore, testState, writeDataFile } from '../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({}))
}))

const CHILD = 'repo-1::/srv/child'
const CHILD_KEY = `worktree:${CHILD}` as const

const worktreeParent = (confidence: 'explicit' | 'inferred'): WorktreeLineage => ({
  worktreeId: CHILD,
  worktreeInstanceId: 'child-instance',
  parentWorktreeId: 'repo-1::/srv/parent',
  parentWorktreeInstanceId: 'parent-instance',
  origin: confidence === 'explicit' ? 'manual' : 'orchestration',
  capture:
    confidence === 'explicit'
      ? { source: 'manual-action', confidence }
      : { source: 'orchestration-context', confidence },
  createdAt: 1
})

const folderParent: WorkspaceLineage = {
  childWorkspaceKey: CHILD_KEY,
  childInstanceId: 'child-instance',
  parentWorkspaceKey: 'folder:folder-1',
  parentInstanceId: null,
  origin: 'manual',
  capture: { source: 'manual-action', confidence: 'explicit' },
  createdAt: 2
}

const crossMachineParent: CrossStoreWorkspaceLineage = {
  childWorkspaceKey: CHILD_KEY,
  childInstanceId: 'child-instance',
  parent: {
    installationId: 'other-install',
    workspaceKey: 'worktree:other-repo::/srv/parent',
    instanceId: 'other-parent'
  },
  origin: 'manual',
  capture: { source: 'manual-action', confidence: 'explicit' },
  createdAt: 1
}

function withLineage(
  worktreeLineage: WorktreeLineage[],
  workspaceLineage: WorkspaceLineage[]
): TopodMigrationManifest {
  const dormantState: TopodMigrationDormantStatePayload = {
    version: 1,
    worktreeMeta: [],
    worktreeLineage: worktreeLineage.map((lineage) => ({
      sourceKey: CHILD,
      worktreeId: CHILD,
      lineage
    })),
    workspaceLineage: workspaceLineage.map((lineage) => ({
      sourceKey: CHILD_KEY,
      childWorkspaceKey: CHILD_KEY,
      lineage
    })),
    sparsePresets: [],
    retiredWorktreeNames: [],
    retiredWorktreeNamespaces: []
  }
  // The real parser and its reference checks admit the payload, as a staged import would.
  return parseTopodMigrationManifest(manifest({ payload: { ...manifest().payload, dormantState } }))
}

function commit(store: ReturnType<typeof createStore>, input: TopodMigrationManifest) {
  store.stageTopodMigrationCatalog(input)
  return store.commitStagedTopodMigrationCatalog(input)
}

describe('topod migration lineage', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'topo-migration-lineage-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it.each(['saved here', 'saved here and repeated', 'only in the import'] as const)(
    'keeps a folder parent over an inferred worktree parent %s',
    (inferredParent) => {
      if (inferredParent !== 'only in the import') {
        writeDataFile({
          ...getDefaultPersistedState(testState.dir),
          worktreeLineageById: { [CHILD]: worktreeParent('inferred') }
        })
      }
      const store = createStore()

      commit(
        store,
        withLineage(inferredParent === 'saved here' ? [] : [worktreeParent('inferred')], [
          folderParent
        ])
      )

      expect(store.getWorktreeLineage(CHILD)).toBeUndefined()
      expect(store.getWorkspaceLineage(CHILD_KEY)?.parentWorkspaceKey).toBe('folder:folder-1')
    }
  )

  it('refuses a payload whose worktree has two explicit parents, changing nothing', () => {
    const store = createStore()

    expect(() => commit(store, withLineage([worktreeParent('explicit')], [folderParent]))).toThrow(
      'topod_migration_dormant_id_conflict:lineage_parent'
    )

    expect(store.getRepos()).toEqual([])
    expect(store.getWorktreeLineage(CHILD)).toBeUndefined()
    expect(store.getWorkspaceLineage(CHILD_KEY)).toBeUndefined()
  })

  it('refuses at commit when a parent on another machine appears after staging', () => {
    const store = createStore()
    const input = withLineage([], [folderParent])
    store.stageTopodMigrationCatalog(input)
    store.setCrossStoreWorkspaceLineage(crossMachineParent, 'local')

    expect(() => store.commitStagedTopodMigrationCatalog(input)).toThrow(
      'topod_migration_dormant_id_conflict:lineage_parent'
    )

    expect(store.getTopodMigrationCatalogState(input)).toMatchObject({ state: 'staged' })
    expect(store.getRepos()).toEqual([])
    expect(store.getWorkspaceLineage(CHILD_KEY)).toBeUndefined()
    expect(store.getCrossStoreWorkspaceLineage(CHILD_KEY)?.parent.installationId).toBe(
      'other-install'
    )
  })
})
