import { z } from 'zod'
import {
  MAX_TOPOD_MIGRATION_BLOBS,
  TopodMigrationBlobDescriptorSchema
} from '../topod-migration/topod-migration-blob-transfer'

// Let the handler parse/digest-check the manifest so malformed input receives a migration-specific refusal.
export const TopodMigrationCatalogParams = z.object({ manifest: z.unknown() })

// Optional: sent only to a blob-channel destination, so SSH and older peers see `{ manifest }`.
export const TopodMigrationCommitCatalogParams = TopodMigrationCatalogParams.extend({
  expectedBlobs: z
    .array(TopodMigrationBlobDescriptorSchema)
    .max(MAX_TOPOD_MIGRATION_BLOBS)
    .optional()
})

// The manifest's identity alone, for a request the whole manifest would overflow.
export const TopodMigrationCatalogReferenceParams = z.object({
  migrationId: z.string().min(1).max(256),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
