import { parseTopodMigrationSnapshotChunkResult } from '../../../../shared/topod-migration/topod-migration-scrollback'
import type {
  TopodMigrationSnapshotChunkRequest,
  TopodMigrationSnapshotChunkResult
} from '../../../../shared/topod-migration/topod-migration-scrollback'

import {
  findUnsupportedMigrationBlobKind,
  topodMigrationBlobKindUnsupportedBlocker,
  parseTopodMigrationBlobChunkResult
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'

import type {
  TopodMigrationBlobChunkRequest,
  TopodMigrationBlobChunkResult
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'

import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import type { CatalogRequestOptions } from '../catalog/topod-migration-request'
import { sendSupportedMigrationRequest } from '../catalog/topod-migration-request'

export async function stageRemoteTopodMigrationSnapshotChunk(
  pairingCode: string,
  request: TopodMigrationSnapshotChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationSnapshotChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('topod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'topod.migration.stageSnapshotChunk',
    request,
    options
  )
  if (!response.ok) {
    throw new Error(`topod_migration_snapshot_failed:${response.error.message}`)
  }
  return parseTopodMigrationSnapshotChunkResult(response.result, request)
}

export async function stageRemoteTopodMigrationBlobChunk(
  pairingCode: string,
  request: TopodMigrationBlobChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationBlobChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('topod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'topod.migration.stageBlobChunk',
    request,
    options,
    false,
    null,
    // Recheck every request so a downgraded destination cannot stage an unsupported blob kind.
    (capabilities) => {
      const unsupported = findUnsupportedMigrationBlobKind([request.blob], capabilities)
      if (unsupported) {
        throw new Error(topodMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`topod_migration_blob_failed:${response.error.message}`)
  }
  return parseTopodMigrationBlobChunkResult(response.result, request)
}
