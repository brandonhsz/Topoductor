import { createHash } from 'node:crypto'
import {
  topodMigrationManifestHashInput,
  serializeTopodMigrationValue,
  type TopodMigrationManifest
} from '../../shared/topod-migration/topod-migration-manifest'

export function computeTopodMigrationManifestSha256(
  manifest: Omit<TopodMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(topodMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertTopodMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('topod_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeTopodMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('topod_migration_manifest_digest_mismatch')
  }
}
