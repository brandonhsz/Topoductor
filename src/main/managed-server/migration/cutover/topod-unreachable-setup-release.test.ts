import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getManagedTopodFenceEnvironmentId } from '../../../../shared/managed-topod-ssh-owner'
import { encodePairingOffer } from '../../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { addManagedTopodEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { SshTarget } from '../../../../shared/ssh-types'
import {
  closeTestStores,
  createSqliteTestStore
} from '../../../persistence/persistence-test-harness'
import { Store } from '../../../persistence/loading-store/store'
import { stageTopodMigrationDestination } from './topod-migration-cutover-coordinator'
import { listTopodMigrationSourceCutovers } from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import { fakeTopodMigrationDestination } from './testing/topod-migration-destination-fake'
import { fenceTopodMigrationSource } from '../../../ssh/migration-source/topod-migration-source-fence'
import { releaseUnreachableTopodSetup } from './topod-unreachable-setup-release'
import { SshTargetTopodClaims } from '../../../ssh/targets/ssh-target-topod-claims'

const TARGET: SshTarget = {
  id: 'ssh-locked',
  label: 'Locked down',
  host: 'locked.example.com',
  port: 22,
  username: 'dev',
  generation: 2
}
const LOCAL_PORT = 46_900

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function strandedConversion() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'topod-unreachable-setup-'))
  directories.push(userDataPath)
  const store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'topo-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo({
    id: 'repo-1',
    path: '/srv/app',
    displayName: 'App',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
  const claims = new SshTargetTopodClaims(store)
  const fenced = await fenceTopodMigrationSource({
    userDataPath,
    store,
    claims,
    targetId: TARGET.id,
    destinationEnvironmentId: 'env-1',
    destinationName: 'Managed',
    terminalProof: { verdict: 'exited', provenPtyIds: [] }
  })
  if (fenced.outcome !== 'fenced') {
    throw new Error('expected a fence')
  }
  addManagedTopodEnvironment(userDataPath, {
    id: 'env-1',
    name: 'Managed',
    pairingCode: encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint: `ws://127.0.0.1:${LOCAL_PORT}/`,
      deviceToken: 'device-token',
      publicKeyB64: 'public-key'
    }),
    topodDeployment: {
      sshTargetId: TARGET.id,
      sshTargetGeneration: store.getSshTarget(TARGET.id)!.generation!,
      localPort: LOCAL_PORT,
      remotePort: 6_768
    }
  })
  return { userDataPath, store, claims, migrationId: fenced.cutover.migrationId }
}

describe('releasing a setup the host never let this client reach', () => {
  it('unregisters the server and releases the fence, keeping every source row', async () => {
    const h = await strandedConversion()

    await releaseUnreachableTopodSetup({ ...h, targetId: TARGET.id })

    expect(getManagedTopodFenceEnvironmentId(h.store.getSshTarget(TARGET.id))).toBeNull()
    expect(listTopodMigrationSourceCutovers(h.userDataPath)).toEqual([])
    expect(listEnvironments(h.userDataPath)).toEqual([])
    expect(h.store.getRepos()).toEqual([expect.objectContaining({ id: 'repo-1' })])
  })

  it('leaves a server that already holds staged state alone', async () => {
    const h = await strandedConversion()
    const destination = fakeTopodMigrationDestination()
    await stageTopodMigrationDestination(
      { userDataPath: h.userDataPath, store: h.store, claims: h.claims, destination },
      h.migrationId
    )

    await releaseUnreachableTopodSetup({ ...h, targetId: TARGET.id })

    expect(getManagedTopodFenceEnvironmentId(h.store.getSshTarget(TARGET.id))).toBe('env-1')
    expect(listEnvironments(h.userDataPath)).toHaveLength(1)
  })
})
