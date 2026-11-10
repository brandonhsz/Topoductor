import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/topod-migration/topod-migration-manifest-validation'
import type { TopodMigrationManifest } from '../../../../shared/topod-migration/topod-migration-manifest'
import { computeTopodMigrationManifestSha256 } from '../../../topod/topod-migration-manifest-digest'
import { encodePairingOffer } from '../../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted(() => ({ capabilities: ['topod.migration-catalog.v1'] }))
// Run status preflight, then adapt to the existing single-call assertions.
vi.mock('../../../../shared/remote-runtime/requests/remote-runtime-request-socket', () => ({
  sendRemoteRuntimeRequestOnSocket: async (
    pairing: unknown,
    method: string,
    params: unknown,
    timeoutMs: number,
    envelope: unknown,
    validate: (response: unknown) => void,
    signal: unknown,
    capabilities: unknown
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params, timeoutMs, envelope, signal, capabilities)
  }
}))

const { readRemoteTopodMigrationCatalogState } = await import('./topod-migration-catalog-client')
const { stageRemoteTopodMigrationSnapshotChunk } =
  await import('../transfers/topod-migration-chunk-client')

function manifest(): TopodMigrationManifest {
  const unsigned = {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-1',
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'ssh-prod',
      sshTargetGeneration: 7,
      targetLabel: 'Production'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return { ...unsigned, manifestSha256: computeTopodMigrationManifestSha256(unsigned) }
}

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

beforeEach(() => {
  vi.clearAllMocks()
  status.capabilities = ['topod.migration-catalog.v1']
})

describe('remote topod migration catalog client', () => {
  it('pins snapshot acknowledgments to the admitted destination runtime', async () => {
    const request = {
      migrationId: 'migration-1',
      manifestSha256: manifest().manifestSha256,
      ref: `v1-${'1'.repeat(32)}`,
      offset: 0,
      bytesBase64: 'YQ=='
    }
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'other' },
      result: { ...request, acknowledgedOffset: 1 }
    })
    await expect(
      stageRemoteTopodMigrationSnapshotChunk(pairingCode, request, { expectedRuntimeId: 'runtime' })
    ).rejects.toThrow('destination_runtime_mismatch')
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { ...request, acknowledgedOffset: 1 }
    })
    await expect(
      stageRemoteTopodMigrationSnapshotChunk(pairingCode, request, { expectedRuntimeId: 'runtime' })
    ).resolves.toMatchObject({ acknowledgedOffset: 1 })
  })

  it('fails closed when a staged old host omits required snapshot upload state', async () => {
    const input = manifest()
    input.payload.dormantState = {
      version: 1,
      worktreeMeta: [],
      worktreeLineage: [],
      workspaceLineage: [],
      sparsePresets: [],
      retiredWorktreeNames: [],
      retiredWorktreeNamespaces: [],
      terminalScrollbackSnapshots: [
        {
          tabId: 'tab-1',
          leafId: 'leaf-1',
          ref: `v1-${'1'.repeat(32)}`,
          sha256: 'b'.repeat(64),
          byteLength: 1
        }
      ]
    }
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        state: 'staged',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256,
        stagedAt: '2026-08-30T12:01:00.000Z'
      }
    })

    await expect(readRemoteTopodMigrationCatalogState(pairingCode, input)).rejects.toThrow(
      'topod_migration_snapshot_transfer_unsupported'
    )
  })

  // #37051: an older host would parse past the history reference and import the automations runless.
})
