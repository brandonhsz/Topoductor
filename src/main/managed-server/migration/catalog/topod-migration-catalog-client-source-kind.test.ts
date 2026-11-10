import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOPOD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/topod-migration/topod-migration-manifest-validation'
import type { TopodMigrationManifest } from '../../../../shared/topod-migration/topod-migration-manifest'

import { TOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY } from '../../../../shared/topod-runtime-capabilities'
import { encodePairingOffer } from '../../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { computeTopodMigrationManifestSha256 } from '../../../topod/topod-migration-manifest-digest'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted((): { capabilities: string[] } => ({ capabilities: [] }))
vi.mock('../../../../shared/remote-runtime/requests/remote-runtime-request-socket', () => ({
  sendRemoteRuntimeRequestOnSocket: async (
    pairing: unknown,
    method: string,
    params: unknown,
    _timeoutMs: number,
    _envelope: unknown,
    validate: (response: unknown) => void
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params)
  }
}))

const {
  abortRemoteTopodMigrationCatalog,
  commitRemoteTopodMigrationCatalog,
  readRemoteTopodMigrationCatalogState,
  stageRemoteTopodMigrationCatalog
} = await import('./topod-migration-catalog-client')
const { TOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED } =
  await import('./topod-migration-request')

const OPERATIONS = [
  stageRemoteTopodMigrationCatalog,
  commitRemoteTopodMigrationCatalog,
  readRemoteTopodMigrationCatalogState,
  abortRemoteTopodMigrationCatalog
]

function sshManifest(): TopodMigrationManifest {
  const unsigned = {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-kind',
    createdAt: '2026-10-01T00:00:00.000Z',
    source: { sshTargetId: 'ssh-prod', sshTargetGeneration: 7, targetLabel: 'Production' },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return { ...unsigned, manifestSha256: computeTopodMigrationManifestSha256(unsigned) }
}

/** Include unknown wire kinds from newer or malformed peers. */
function manifestOfKind(kind: string): TopodMigrationManifest {
  const source: TopodMigrationManifest['source'] = {
    kind: 'local-wsl',
    distro: 'Ubuntu',
    scopeRepoIds: [],
    scopeFolderWorkspaceIds: [],
    generation: 1
  }
  Object.assign(source, { kind })
  return { ...sshManifest(), source }
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
  sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'sent' } })
  status.capabilities = [TOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]
})

describe('topod migration source-kind capability gate', () => {
  it.each(OPERATIONS)('never sends a WSL manifest to an older destination', async (op) => {
    await expect(op(pairingCode, manifestOfKind('local-wsl'))).rejects.toThrow(
      TOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
