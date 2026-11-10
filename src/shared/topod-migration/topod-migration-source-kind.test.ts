import { describe, expect, it } from 'vitest'
import { isRecord } from './topod-migration-manifest-fields'
import {
  TOPOD_MIGRATION_MANIFEST_VERSION,
  normalizeTopodMigrationImportReceipts,
  parseTopodMigrationManifest
} from './topod-migration-manifest-validation'
import {
  TOPOD_MIGRATION_SOURCE_KIND_UNKNOWN,
  topodMigrationManifestSourceKind
} from './topod-migration-source-kind'

const SSH_SOURCE = { sshTargetId: 'ssh-1', sshTargetGeneration: 2, targetLabel: 'Prod' }
const WSL_SOURCE = {
  kind: 'local-wsl',
  distro: 'Ubuntu',
  scopeRepoIds: ['repo-1'],
  scopeFolderWorkspaceIds: [],
  generation: 1
}
const WSL_REPO = {
  id: 'repo-1',
  path: '/home/dev/app',
  displayName: 'app',
  badgeColor: '#000',
  addedAt: 0
}

/** Exactly what a desktop that predates `source.kind` sends. */
function manifestWithSource(source: unknown) {
  return {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-kind',
    createdAt: '2026-10-01T00:00:00.000Z',
    source,
    payload: {
      repositories: isRecord(source) && source.kind === 'local-wsl' ? [WSL_REPO] : [],
      projectGroups: [],
      folderWorkspaces: []
    },
    manifestSha256: 'a'.repeat(64)
  }
}

describe('topod migration source kind', () => {
  it.each(['ssh-relay', 'toString', 'wsl', 7, null])('refuses unregistered kind %j', (kind) => {
    expect(() => topodMigrationManifestSourceKind({ kind })).toThrow(
      TOPOD_MIGRATION_SOURCE_KIND_UNKNOWN
    )
  })
})

describe('topod migration manifest source on the destination', () => {
  it('accepts an older desktop manifest and its receipt unchanged', () => {
    expect(parseTopodMigrationManifest(manifestWithSource(SSH_SOURCE)).source).toEqual(SSH_SOURCE)
    const receipt = {
      version: TOPOD_MIGRATION_MANIFEST_VERSION,
      migrationId: 'migration-kind',
      manifestSha256: 'a'.repeat(64),
      source: SSH_SOURCE,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
    expect(normalizeTopodMigrationImportReceipts([receipt])).toEqual([receipt])
  })

  it('refuses an explicit SSH kind, and a WSL source carrying SSH fields', () => {
    expect(() =>
      parseTopodMigrationManifest(manifestWithSource({ ...SSH_SOURCE, kind: 'ssh-relay' }))
    ).toThrow('topod_migration_manifest_source_kind_unsupported')
    expect(() =>
      parseTopodMigrationManifest(manifestWithSource({ ...WSL_SOURCE, sshTargetId: 'ssh-1' }))
    ).toThrow('topod_migration_manifest_source_invalid')
  })

  it('parses a WSL source whose scope is exactly the catalog it moves', () => {
    const manifest = parseTopodMigrationManifest(
      manifestWithSource({ ...WSL_SOURCE, distroGuid: '{guid}' })
    )
    expect(manifest.source).toEqual({ ...WSL_SOURCE, distroGuid: '{guid}' })
  })

  it.each([
    { scopeRepoIds: ['repo-other'] },
    { scopeRepoIds: [] },
    { scopeFolderWorkspaceIds: ['folder-1'] },
    { generation: 0 },
    { distro: '' }
  ])('refuses a WSL source that does not describe its catalog: %j', (override) => {
    expect(() =>
      parseTopodMigrationManifest(manifestWithSource({ ...WSL_SOURCE, ...override }))
    ).toThrow(/source/)
  })

  it('fails a WSL source closed on a destination that drops the kind', () => {
    // Without the SSH fields, even a parser that ignores `kind` cannot read it as an SSH source.
    const { kind: _kind, ...asOlderDestinationSeesIt } = {
      kind: 'local-wsl',
      distro: 'Ubuntu',
      targetLabel: 'Ubuntu'
    }
    expect(() => parseTopodMigrationManifest(manifestWithSource(asOlderDestinationSeesIt))).toThrow(
      /^topod_migration_manifest_source/
    )
  })
})
