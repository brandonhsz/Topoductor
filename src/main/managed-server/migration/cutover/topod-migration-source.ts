/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { TopodMigrationSourceKind } from '../../../../shared/topod-migration/topod-migration-source-kind'
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'
import type { TopodMigrationSourceCutover } from '../../../../shared/topod-migration/topod-migration-source-cutover'
import type {
  TopodMigrationExportedBlob,
  TopodMigrationManifestExportOptions
} from '../../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import type {
  TopodMigrationFenceResult,
  TopodMigrationFenceState
} from '../../../ssh/migration-source/topod-migration-source-fence'
import type { TopodMigrationTerminalVerdict } from '../../../ssh/migration-source/topod-migration-terminal-gate'

export type TopodMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal.
   * Returns the bytes of the blobs its manifest names, which that match proves are the journaled ones. */
  verifyFence: (cutover: TopodMigrationSourceCutover) => TopodMigrationExportedBlob[]
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: TopodMigrationSourceCutover) => Promise<void>
}

type TopodMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: TopodMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type TopodMigrationSource = TopodMigrationSourceCutoverPort & {
  readonly kind: TopodMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => TopodMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: TopodMigrationManifestExportOptions) => TopodMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<TopodMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: TopodMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => TopodMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: TopodMigrationFenceAcquireArgs) => Promise<TopodMigrationFenceResult>
}
