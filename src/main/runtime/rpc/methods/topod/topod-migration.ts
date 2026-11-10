import type { z } from 'zod'
import {
  TopodMigrationCatalogParams,
  TopodMigrationCatalogReferenceParams,
  TopodMigrationCommitCatalogParams
} from '../../../../../shared/rpc-contract/topod-migration-params'
import { parseTopodMigrationManifest } from '../../../../../shared/topod-migration/topod-migration-manifest-validation'
import { TopodMigrationSnapshotChunkRequestSchema } from '../../../../../shared/topod-migration/topod-migration-scrollback'
import { TopodMigrationBlobChunkRequestSchema } from '../../../../../shared/topod-migration/topod-migration-blob-transfer'
import { assertTopodMigrationManifestDigest } from '../../../../topod/topod-migration-manifest-digest'
import { assertTopodMigrationSourceServedHere } from '../../../../topod/topod-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../../core'

export const TOPOD_MIGRATION_METHODS = [
  defineMethod({
    name: 'topod.migration.stageCatalog',
    permission: 'host-admin',
    params: TopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageTopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'topod.migration.commitCatalog',
    permission: 'host-admin',
    params: TopodMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedTopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'topod.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: TopodMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageTopodMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'topod.migration.stageBlobChunk',
    permission: 'host-admin',
    params: TopodMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageTopodMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'topod.migration.abortCatalog',
    permission: 'host-admin',
    params: TopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedTopodMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'topod.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: TopodMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedTopodMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'topod.migration.catalogState',
    permission: 'host-admin',
    params: TopodMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getTopodMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof TopodMigrationCatalogParams>) {
  const manifest = parseTopodMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertTopodMigrationManifestDigest(params.manifest)
  assertTopodMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('topod_migration_runtime_client_required')
  }
}
