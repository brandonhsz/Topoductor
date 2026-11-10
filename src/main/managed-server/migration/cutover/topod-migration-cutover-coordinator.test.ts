import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getManagedTopodFenceEnvironmentId } from '../../../../shared/managed-topod-ssh-owner'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { TopodMigrationManifest } from '../../../../shared/topod-migration/topod-migration-manifest'
import {
  closeTestStores,
  createSqliteTestStore
} from '../../../persistence/persistence-test-harness'
import { Store } from '../../../persistence/loading-store/store'
import {
  abortTopodMigrationCutover,
  commitTopodMigrationDestination,
  stageTopodMigrationDestination,
  type TopodMigrationCutoverContext
} from './topod-migration-cutover-coordinator'
import { TOPOD_MIGRATION_DESTINATION_UNSUPPORTED } from '../catalog/topod-migration-request'
import {
  listTopodMigrationSourceCutovers,
  writeTopodMigrationSourceCutover
} from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import { assertTopodMigrationRequestFits } from '../catalog/topod-migration-request-budget'
import { createTopodMigrationManifest } from '../../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import { MAX_TOPOD_MIGRATION_MANIFEST_BYTES } from '../../../../shared/topod-migration/topod-migration-manifest-validation'
import { fenceTopodMigrationSource } from '../../../ssh/migration-source/topod-migration-source-fence'
import { SshTargetTopodClaims } from '../../../ssh/targets/ssh-target-topod-claims'
import { fakeTopodMigrationDestination as fakeDestination } from './testing/topod-migration-destination-fake'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function setup() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'topod-cutover-coordinator-'))
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
  const destination = fakeDestination()
  const context: TopodMigrationCutoverContext = { userDataPath, store, claims, destination }
  const journal = () => listTopodMigrationSourceCutovers(userDataPath)[0]
  const owner = () => getManagedTopodFenceEnvironmentId(store.getSshTarget(TARGET.id))
  return { context, destination, store, migrationId: fenced.cutover.migrationId, journal, owner }
}

describe('migration cutover coordinator', () => {
  it('never journals a commit the server holds only in memory, until its flush succeeds', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    const commit = h.destination.commit.getMockImplementation()!
    let diskFull = true
    // Committed reads can reflect memory while the durable flush still fails.
    h.destination.commit.mockImplementation(async (manifest) => {
      const state = await commit(manifest)
      if (diskFull) {
        throw new Error('disk full')
      }
      return state
    })
    await expect(commitTopodMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(commitTopodMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'disk full'
    )
    await expect(abortTopodMigrationCutover(h.context, h.migrationId)).rejects.toThrow('disk full')
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')

    diskFull = false
    await expect(commitTopodMigrationDestination(h.context, h.migrationId)).resolves.toMatchObject({
      phase: 'destination-committed'
    })
  })

  it('keeps the journal at staged when the commit reply and the re-read are both lost', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    h.destination.commit.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    await expect(commitTopodMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.journal()?.phase).toBe('destination-staged')
    expect(h.owner()).toBe('env-1')
  })

  it('refuses a commit whose source changed after staging', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    h.store.updateRepo(h.store.getRepo('repo-1')!, { displayName: 'Renamed' })
    await expect(commitTopodMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'topod_migration_source_changed'
    )
    expect(h.destination.commit).not.toHaveBeenCalled()
  })

  it('aborts a stage and releases the fence only once the destination proves it absent', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'catalog-absent'
    })
    expect(h.owner()).toBeNull()
    expect(h.journal()).toBeUndefined()
  })

  it('keeps the fence when the abort answer is lost and the destination cannot be read', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    h.destination.abort.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.readState.mockResolvedValueOnce({
      state: 'absent',
      migrationId: h.migrationId,
      manifestSha256: h.journal()!.manifestSha256
    })
    h.destination.readState.mockRejectedValueOnce(new Error('socket closed'))
    h.destination.abort.mockRejectedValueOnce(new Error('socket closed'))
    await expect(abortTopodMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
      'socket closed'
    )
    expect(h.owner()).toBe('env-1')
    expect(h.journal()?.phase).toBe('destination-staged')
  })

  it('never releases a committed destination, even when the journal lags behind it', async () => {
    const h = await setup()
    await stageTopodMigrationDestination(h.context, h.migrationId)
    await h.destination.commit(h.journal()!.manifest)
    await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused',
      code: 'topod_migration_committed_source_cannot_be_released'
    })
    expect(h.journal()?.phase).toBe('destination-committed')
    expect(h.owner()).toBe('env-1')
    await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
      outcome: 'refused'
    })
  })

  it('releases on an unsupported destination only before anything was staged', async () => {
    const unsupported = new Error(TOPOD_MIGRATION_DESTINATION_UNSUPPORTED)
    const fresh = await setup()
    fresh.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortTopodMigrationCutover(fresh.context, fresh.migrationId)).resolves.toEqual({
      outcome: 'released',
      evidence: 'destination-unsupported'
    })
    expect(fresh.owner()).toBeNull()

    const staged = await setup()
    await stageTopodMigrationDestination(staged.context, staged.migrationId)
    staged.destination.readState.mockRejectedValueOnce(unsupported)
    await expect(abortTopodMigrationCutover(staged.context, staged.migrationId)).rejects.toThrow(
      TOPOD_MIGRATION_DESTINATION_UNSUPPORTED
    )
    expect(staged.owner()).toBe('env-1')
  })

  it('refuses a destination answer for another manifest', async () => {
    const h = await setup()
    h.destination.stage.mockResolvedValueOnce({
      state: 'staged',
      migrationId: h.migrationId,
      manifestSha256: 'f'.repeat(64),
      stagedAt: '2026-10-01T00:00:00.000Z'
    })
    await expect(stageTopodMigrationDestination(h.context, h.migrationId)).rejects.toThrow(
      'topod_migration_destination_state_mismatch'
    )
    expect(h.journal()?.phase).toBe('source-fenced')
  })

  describe('a journal fenced before #30836 on a manifest no request can carry', () => {
    async function stuck(stagedByOlderBuild = false) {
      const h = await setup()
      const cutover = h.journal()!
      const target = {
        ...h.store.getSshTarget(TARGET.id)!,
        generation: cutover.sshTargetGeneration
      }
      const exportFor = () =>
        createTopodMigrationManifest(h.store, target, {
          migrationId: cutover.migrationId,
          destinationEnvironmentId: cutover.destinationEnvironmentId
        })
      const baseline = JSON.stringify(exportFor()).length
      // Under the export cap, over the sealed-frame request budget.
      h.store.updateRepo(h.store.getRepo('repo-1')!, {
        displayName: 'x'.repeat(MAX_TOPOD_MIGRATION_MANIFEST_BYTES - 200 - baseline)
      })
      const manifest = exportFor()
      expect(() => assertTopodMigrationRequestFits({ manifest })).toThrow(
        /topod_migration_manifest_too_large/
      )
      writeTopodMigrationSourceCutover(h.context.userDataPath, {
        ...cutover,
        manifestSha256: manifest.manifestSha256,
        manifest
      })
      if (stagedByOlderBuild) {
        // A build before the client-side size check sent it whole, and the frame fit.
        await h.destination.stage(manifest)
      }
      // Model client refusal before sending oversized manifest requests.
      const refuseUnsent =
        <T>(real: (sent: TopodMigrationManifest) => Promise<T>) =>
        async (sent: TopodMigrationManifest): Promise<T> => {
          assertTopodMigrationRequestFits({ manifest: sent })
          return real(sent)
        }
      const d = h.destination
      d.readState.mockImplementation(refuseUnsent(d.readState.getMockImplementation()!))
      d.stage.mockImplementation(refuseUnsent(d.stage.getMockImplementation()!))
      d.commit.mockImplementation(refuseUnsent(d.commit.getMockImplementation()!))
      d.abort.mockImplementation(refuseUnsent(d.abort.getMockImplementation()!))
      return { ...h, manifest }
    }

    it('releases the fence once the server, asked by reference, proves it holds nothing', async () => {
      const h = await stuck()
      await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toEqual({
        outcome: 'released',
        evidence: 'catalog-absent'
      })
      expect(h.destination.abortByReference).toHaveBeenCalledWith(h.manifest)
      expect(h.owner()).toBeNull()
      expect(h.journal()).toBeUndefined()
    })

    it('aborts, by reference, a stage an older build delivered whole', async () => {
      const h = await stuck(true)
      await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'released'
      })
      await expect(h.destination.abortByReference.mock.results[0]?.value).resolves.toMatchObject({
        state: 'absent',
        aborted: true
      })
      expect(h.owner()).toBeNull()
    })

    it('keeps the fence when the server cannot answer by reference', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockRejectedValueOnce(new Error('update required'))
      await expect(abortTopodMigrationCutover(h.context, h.migrationId)).rejects.toThrow(
        'update required'
      )
      expect(h.owner()).toBe('env-1')
      expect(h.journal()?.migrationId).toBe(h.migrationId)
    })

    it('never releases a server that already committed it', async () => {
      const h = await stuck()
      h.destination.abortByReference.mockResolvedValueOnce({
        migrationId: h.migrationId,
        manifestSha256: h.manifest.manifestSha256,
        state: 'committed',
        aborted: false
      })
      await expect(abortTopodMigrationCutover(h.context, h.migrationId)).resolves.toMatchObject({
        outcome: 'refused',
        code: 'topod_migration_committed_source_cannot_be_released'
      })
      expect(h.owner()).toBe('env-1')
    })
  })
})
