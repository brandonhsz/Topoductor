import { vi, type Mock } from 'vitest'
import type {
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../../shared/topod-migration/topod-migration-manifest'
import { parseTopodMigrationManifest } from '../../../../../shared/topod-migration/topod-migration-manifest-validation'
import { advertisedTopodMigrationDestinationCapabilities } from '../../../../topod/topod-migration-destination-capabilities'
import { assertTopodMigrationManifestDigest } from '../../../../topod/topod-migration-manifest-digest'
import type { Store } from '../../../../persistence/loading-store/store'
import type { TopodMigrationDestinationCatalog } from '../topod-migration-cutover-coordinator'

type Catalog = TopodMigrationDestinationCatalog

export type FakeTopodMigrationDestination = { commits: number } & {
  [Method in keyof Catalog]: Mock<Catalog[Method]>
}

/** Model idempotent stage and receipt-keyed commit with separate catalog state for each migration, including later deltas. */
export function fakeTopodMigrationDestination(): FakeTopodMigrationDestination {
  const states = new Map<string, 'absent' | 'staged' | 'committed'>()
  const stateOf = (manifest: Pick<TopodMigrationManifest, 'migrationId'>) =>
    states.get(manifest.migrationId) ?? 'absent'
  const view = (manifest: TopodMigrationManifest): TopodMigrationCatalogState => {
    const state = stateOf(manifest)
    const base = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
    if (state === 'committed') {
      return {
        ...base,
        state,
        receipt: {
          version: 1,
          migrationId: manifest.migrationId,
          manifestSha256: manifest.manifestSha256,
          source: manifest.source,
          importedAt: '2026-10-01T00:00:00.000Z',
          repositoryIds: [],
          projectGroupIds: [],
          folderWorkspaceIds: []
        }
      }
    }
    return state === 'staged'
      ? { ...base, state, stagedAt: '2026-10-01T00:00:00.000Z', snapshotUploads: [] }
      : { ...base, state }
  }
  const destination: FakeTopodMigrationDestination = {
    commits: 0,
    readState: vi.fn<Catalog['readState']>(async (manifest: TopodMigrationManifest) =>
      view(manifest)
    ),
    stage: vi.fn<Catalog['stage']>(async (manifest: TopodMigrationManifest) => {
      if (stateOf(manifest) === 'absent') {
        states.set(manifest.migrationId, 'staged')
      }
      return view(manifest)
    }),
    commit: vi.fn<Catalog['commit']>(async (manifest: TopodMigrationManifest) => {
      if (stateOf(manifest) === 'staged') {
        states.set(manifest.migrationId, 'committed')
        destination.commits += 1
      }
      return view(manifest)
    }),
    abort: vi.fn<Catalog['abort']>(async (manifest: TopodMigrationManifest) => {
      const aborted = stateOf(manifest) === 'staged'
      if (aborted) {
        states.set(manifest.migrationId, 'absent')
      }
      return { ...view(manifest), aborted, ...(aborted ? {} : { durableAbsent: true as const }) }
    }),
    abortByReference: vi.fn<Catalog['abortByReference']>(async (manifest) => {
      const identity = {
        migrationId: manifest.migrationId,
        manifestSha256: manifest.manifestSha256
      }
      if (stateOf(manifest) === 'committed') {
        return { ...identity, state: 'committed', aborted: false }
      }
      const aborted = stateOf(manifest) === 'staged'
      states.delete(manifest.migrationId)
      return { ...identity, state: 'absent', aborted, durableAbsent: true }
    }),
    stageChunk: vi.fn<Catalog['stageChunk']>(),
    readCapabilities: vi.fn<Catalog['readCapabilities']>(async () => []),
    stageBlobChunk: vi.fn<Catalog['stageBlobChunk']>()
  }
  return destination
}

/** A host server's real import, behind manifests sent as the RPC handler receives them. */
export function storeBackedTopodMigrationDestination(server: Store): Catalog {
  const sent = (manifest: TopodMigrationManifest): TopodMigrationManifest => {
    const raw = JSON.parse(JSON.stringify(manifest))
    assertTopodMigrationManifestDigest(raw)
    return parseTopodMigrationManifest(raw)
  }
  return {
    readState: async (manifest) => server.getTopodMigrationCatalogState(sent(manifest)),
    stage: async (manifest) => server.stageTopodMigrationCatalog(sent(manifest)),
    commit: async (manifest) => server.commitStagedTopodMigrationCatalog(sent(manifest)),
    abort: async (manifest) => {
      const result = server.abortStagedTopodMigrationCatalog(sent(manifest))
      return result.aborted ? result : { ...result, durableAbsent: true as const }
    },
    abortByReference: async (reference) =>
      server.abortStagedTopodMigrationCatalogByReference(reference),
    stageChunk: async (request) => server.stageTopodMigrationSnapshotChunk(request),
    readCapabilities: async () => advertisedTopodMigrationDestinationCapabilities(),
    stageBlobChunk: async (request) => server.stageTopodMigrationBlobChunk(request)
  }
}
