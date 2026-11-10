import type { TopodMigrationManifest } from '../../../../shared/topod-migration/topod-migration-manifest'
import { REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES } from '../../../../shared/remote-runtime/remote-runtime-memory-limits'
import { describeOversizedTopodMigrationPayload } from './topod-migration-payload-capacity'

// Request id, device token, method name and JSON framing around the params.
const REQUEST_ENVELOPE_RESERVE_BYTES = 1024

/** The largest catalog-request params that still fit the host's sealed inbound frame. */
export const TOPOD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES =
  REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES - REQUEST_ENVELOPE_RESERVE_BYTES

/** Reject oversized manifest requests before fencing: stage/state/full abort would all exceed the sealed frame and close its socket. */
export function assertTopodMigrationRequestFits(params: {
  manifest: TopodMigrationManifest
}): void {
  if (!topodMigrationRequestFits(params)) {
    throw new Error(
      describeOversizedTopodMigrationPayload(
        params.manifest.payload,
        TOPOD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
      )
    )
  }
}

export function topodMigrationRequestFits(params: { manifest: TopodMigrationManifest }): boolean {
  return (
    Buffer.byteLength(JSON.stringify(params), 'utf8') <= TOPOD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
  )
}
