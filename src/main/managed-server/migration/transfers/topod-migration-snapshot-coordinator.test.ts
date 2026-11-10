import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/topod-migration/topod-migration-manifest-validation'
import type {
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import type { TopodMigrationTerminalScrollbackSnapshot } from '../../../../shared/topod-migration/topod-migration-scrollback'
import { transferTopodMigrationSnapshots } from './topod-migration-snapshot-coordinator'

const BYTES = Buffer.from('resume these bytes', 'utf8')
const SNAPSHOT: TopodMigrationTerminalScrollbackSnapshot = {
  tabId: 'tab-1',
  leafId: 'leaf-1',
  ref: `v1-${'1'.repeat(32)}`,
  sha256: createHash('sha256').update(BYTES).digest('hex'),
  byteLength: BYTES.length
}
const MANIFEST: TopodMigrationManifest = {
  version: TOPOD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
  payload: {
    repositories: [],
    projectGroups: [],
    folderWorkspaces: [],
    dormantState: {
      version: 1,
      worktreeMeta: [],
      worktreeLineage: [],
      workspaceLineage: [],
      sparsePresets: [],
      retiredWorktreeNames: [],
      retiredWorktreeNamespaces: [],
      terminalScrollbackSnapshots: [SNAPSHOT]
    }
  },
  manifestSha256: 'a'.repeat(64)
}
type ChunkReader = (
  manifest: TopodMigrationManifest,
  ref: string,
  offset: number
) => { bytesBase64: string; totalBytes: number; eof: boolean }

function source(read: ChunkReader) {
  return {
    readTopodMigrationSourceSnapshotChunk: read
  }
}

const unreachableRead: ChunkReader = () => {
  throw new Error('must not read')
}

describe('topod migration snapshot coordinator', () => {
  it('refuses a snapshot whose source length changed since export', async () => {
    await expect(
      transferTopodMigrationSnapshots({
        source: source(() => ({
          bytesBase64: Buffer.from('changed').toString('base64'),
          totalBytes: BYTES.length + 1,
          eof: true
        })),
        manifest: MANIFEST,
        state: staged(0),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => staged(0)
        }
      })
    ).rejects.toThrow('topod_migration_source_snapshot_changed')
  })

  it('requires complete upload evidence after the final chunk', async () => {
    const remoteReads = [staged(BYTES.length - 1)]
    await expect(
      transferTopodMigrationSnapshots({
        source: source(unreachableRead),
        manifest: MANIFEST,
        state: staged(BYTES.length),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => nextState(remoteReads)
        }
      })
    ).rejects.toThrow('topod_migration_snapshot_transfer_incomplete')
  })
})

function staged(receivedBytes?: number): Extract<TopodMigrationCatalogState, { state: 'staged' }> {
  return {
    state: 'staged',
    migrationId: MANIFEST.migrationId,
    manifestSha256: MANIFEST.manifestSha256,
    stagedAt: '2026-08-30T12:01:00.000Z',
    ...(receivedBytes === undefined ? {} : { snapshotUploads: [{ ...SNAPSHOT, receivedBytes }] })
  }
}

function nextState(
  states: Extract<TopodMigrationCatalogState, { state: 'staged' }>[]
): Extract<TopodMigrationCatalogState, { state: 'staged' }> {
  const state = states.shift()
  if (!state) {
    throw new Error('unexpected remote read')
  }
  return state
}
