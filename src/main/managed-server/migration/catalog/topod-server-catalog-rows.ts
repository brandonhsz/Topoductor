import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import type { CatalogRequestOptions } from './topod-migration-request'
import { sendSupportedMigrationRequest } from './topod-migration-request'

export async function listServerRows(
  pairingCode: string,
  method: string,
  rows: string,
  options: CatalogRequestOptions
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('topod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(pairing, method, undefined, options)
  if (!response.ok) {
    throw new Error(`topod_migration_${rows}_failed:${response.error.message}`)
  }
  return response.result
}
