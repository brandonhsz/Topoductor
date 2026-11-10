/** Keep enough of evicted receipts to answer committed; derive the remaining receipt from its manifest. */
import { isRecord } from './topod-migration-manifest-fields'

export const MAX_TOPOD_MIGRATION_EVICTED_RECEIPTS = 4_096

export type TopodMigrationEvictedReceipt = {
  migrationId: string
  manifestSha256: string
  importedAt: string
}

export function normalizeTopodMigrationEvictedReceipts(
  value: unknown
): TopodMigrationEvictedReceipt[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (entry): entry is TopodMigrationEvictedReceipt =>
        isRecord(entry) &&
        typeof entry.migrationId === 'string' &&
        entry.migrationId.length > 0 &&
        typeof entry.manifestSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(entry.manifestSha256) &&
        typeof entry.importedAt === 'string' &&
        Number.isFinite(Date.parse(entry.importedAt))
    )
    .map(({ migrationId, manifestSha256, importedAt }) => ({
      migrationId,
      manifestSha256,
      importedAt
    }))
    .slice(-MAX_TOPOD_MIGRATION_EVICTED_RECEIPTS)
}
