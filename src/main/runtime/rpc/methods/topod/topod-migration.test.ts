import { describe, expect, it, vi } from 'vitest'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../../../shared/topod-migration/topod-migration-manifest-validation'
import type { TopodMigrationManifest } from '../../../../../shared/topod-migration/topod-migration-manifest'
import { computeTopodMigrationManifestSha256 } from '../../../../topod/topod-migration-manifest-digest'
import type { TopoRuntimeService } from '../../../topo-runtime'
import { eraseRpcMethods, isStreamingMethod, type RpcContext } from '../../core'
import '../rpc-method-registry'
import { TOPOD_MIGRATION_METHODS } from './topod-migration'

function manifest(): TopodMigrationManifest {
  const unsigned = {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-1',
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'ssh-prod',
      sshTargetGeneration: 7,
      targetLabel: 'Production'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return {
    ...unsigned,
    manifestSha256: computeTopodMigrationManifestSha256(unsigned)
  }
}

const MIGRATION_METHOD_NAMES = [
  'topod.migration.stageCatalog',
  'topod.migration.commitCatalog',
  'topod.migration.stageSnapshotChunk',
  'topod.migration.stageBlobChunk',
  'topod.migration.abortCatalog',
  'topod.migration.abortCatalogByReference',
  'topod.migration.catalogState'
] as const

function migrationMethod(
  name: (typeof MIGRATION_METHOD_NAMES)[number] = MIGRATION_METHOD_NAMES[0]
) {
  const method = eraseRpcMethods(TOPOD_MIGRATION_METHODS).find(
    (candidate) => candidate.name === name
  )
  if (!method || isStreamingMethod(method)) {
    throw new Error(`Missing or invalid ${name} method`)
  }
  return method
}

function context(
  stageTopodMigrationCatalog: ReturnType<typeof vi.fn>,
  overrides: Partial<RpcContext> = {},
  runtimeOverrides: Record<string, unknown> = {}
): RpcContext {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the migration methods call only the runtime members stubbed here.
    runtime: { stageTopodMigrationCatalog, ...runtimeOverrides } as unknown as TopoRuntimeService,
    clientKind: 'runtime',
    pairedDeviceId: 'paired-desktop',
    ...overrides
  }
}

describe('topod migration RPC', () => {
  it.each([
    ['mobile client', { clientKind: 'mobile', pairedDeviceId: 'paired-phone' }],
    ['unpaired runtime client', { clientKind: 'runtime', pairedDeviceId: undefined }],
    ['local caller', { clientKind: undefined, pairedDeviceId: undefined }]
  ] as const)('rejects a %s before any migration mutation', async (_label, caller) => {
    for (const name of MIGRATION_METHOD_NAMES) {
      const invoke = vi.fn()
      const method = migrationMethod(name)
      const runtimeMethod =
        name === 'topod.migration.stageCatalog'
          ? 'stageTopodMigrationCatalog'
          : name === 'topod.migration.commitCatalog'
            ? 'commitStagedTopodMigrationCatalog'
            : name === 'topod.migration.stageSnapshotChunk'
              ? 'stageTopodMigrationSnapshotChunk'
              : name === 'topod.migration.stageBlobChunk'
                ? 'stageTopodMigrationBlobChunk'
                : name === 'topod.migration.abortCatalog'
                  ? 'abortStagedTopodMigrationCatalog'
                  : name === 'topod.migration.abortCatalogByReference'
                    ? 'abortStagedTopodMigrationCatalogByReference'
                    : 'getTopodMigrationCatalogState'

      await expect(
        method.handler(
          method.params?.parse(migrationMethodInput(name)),
          context(invoke, caller, { [runtimeMethod]: invoke })
        )
      ).rejects.toThrow('topod_migration_runtime_client_required')
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('rejects malformed and tampered manifests before staging', async () => {
    const stageCatalog = vi.fn()
    const method = migrationMethod()
    const input = manifest()

    await expect(
      method.handler(
        method.params?.parse({ manifest: { ...input, manifestSha256: 'invalid' } }),
        context(stageCatalog)
      )
    ).rejects.toThrow('topod_migration_manifest_digest_invalid')
    await expect(
      method.handler(
        method.params?.parse({
          manifest: { ...input, source: { ...input.source, targetLabel: 'Tampered' } }
        }),
        context(stageCatalog)
      )
    ).rejects.toThrow('topod_migration_manifest_digest_mismatch')
    expect(stageCatalog).not.toHaveBeenCalled()
  })

  it('verifies a newer client signature over fields this host does not know', async () => {
    const stageCatalog = vi.fn()
    const method = migrationMethod()
    const { manifestSha256: _, ...known } = manifest()
    const unsigned = {
      ...known,
      futureField: { enabled: true },
      source: { ...known.source, futureSourceField: 'x' }
    }
    const signed = {
      ...unsigned,
      manifestSha256: computeTopodMigrationManifestSha256(unsigned)
    }

    await method.handler(method.params?.parse({ manifest: signed }), context(stageCatalog))
    expect(stageCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ manifestSha256: signed.manifestSha256, source: known.source }),
      expect.anything()
    )
    await expect(
      method.handler(
        method.params?.parse({ manifest: { ...signed, futureField: { enabled: false } } }),
        context(stageCatalog)
      )
    ).rejects.toThrow('topod_migration_manifest_digest_mismatch')
    const { futureField: __, ...stripped } = signed
    await expect(
      method.handler(method.params?.parse({ manifest: stripped }), context(stageCatalog)),
      'a peer that drops a signed field'
    ).rejects.toThrow('topod_migration_manifest_digest_mismatch')
    expect(stageCatalog).toHaveBeenCalledTimes(1)
  })
})

function migrationSnapshotRequest(input: TopodMigrationManifest) {
  return {
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    ref: `v1-${'1'.repeat(32)}`,
    offset: 0,
    bytesBase64: 'YQ=='
  }
}

function migrationMethodInput(name: (typeof MIGRATION_METHOD_NAMES)[number]) {
  const input = manifest()
  if (name === 'topod.migration.stageBlobChunk') {
    return migrationBlobRequest(input)
  }
  if (name === 'topod.migration.abortCatalogByReference') {
    return { migrationId: input.migrationId, manifestSha256: input.manifestSha256 }
  }
  return name === 'topod.migration.stageSnapshotChunk'
    ? migrationSnapshotRequest(input)
    : { manifest: input }
}

function migrationBlobRequest(input: TopodMigrationManifest, key = `${'a'.repeat(16)}-zsh`) {
  return {
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    blob: { blobKind: 'shell-history', key, sha256: 'b'.repeat(64), byteLength: 1 },
    offset: 0,
    bytesBase64: 'YQ=='
  }
}
