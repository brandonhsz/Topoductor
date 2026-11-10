import { parseTopodMigrationCatalogReferenceAbortResult } from '../../../../shared/topod-migration/topod-migration-catalog-state'
import type {
  TopodMigrationCatalogReference,
  TopodMigrationCatalogReferenceAbortResult
} from '../../../../shared/topod-migration/topod-migration-manifest'
import { TOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../../../shared/topod-runtime-capabilities'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  TOPOD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './topod-migration-request'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const TOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'topod_migration_destination_abort_by_reference_unsupported:Update Topo on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteTopodMigrationCatalogByReference(
  pairingCode: string,
  manifest: TopodMigrationCatalogReference,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('topod_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'topod.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          TOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(TOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === TOPOD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(TOPOD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`topod_migration_abort_failed:${response.error.message}`)
  }
  return parseTopodMigrationCatalogReferenceAbortResult(response.result, manifest)
}
