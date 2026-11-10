import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getManagedTopodFenceEnvironmentId } from '../../../shared/managed-topod-ssh-owner'
import type { SshTarget } from '../../../shared/ssh-types'
import { closeTestStores, createSqliteTestStore } from '../../persistence/persistence-test-harness'
import { Store } from '../../persistence/loading-store/store'
import {
  listTopodMigrationSourceCutovers,
  topodMigrationCutoverJournalDirectory
} from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  fenceTopodMigrationSource,
  resolveTopodMigrationFence
} from './topod-migration-source-fence'
import type { TopodMigrationTerminalVerdict } from './topod-migration-terminal-gate'
import { SshTargetTopodClaims } from '../targets/ssh-target-topod-claims'
import '../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import '../../../shared/topod-migration/topod-migration-manifest-validation'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}
const exited: TopodMigrationTerminalVerdict = { verdict: 'exited', provenPtyIds: [] }

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function setup(displayName = 'App') {
  const userDataPath = mkdtempSync(join(tmpdir(), 'topod-migration-fence-'))
  directories.push(userDataPath)
  const dataFile = join(userDataPath, 'topo-data.json')
  const store = createSqliteTestStore(Store, { dataFile })
  store.addSshTarget(TARGET)
  store.addRepo({
    id: 'repo-1',
    path: '/srv/app',
    displayName,
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
  const claims = new SshTargetTopodClaims(store)
  const fence = (overrides: Partial<Parameters<typeof fenceTopodMigrationSource>[0]> = {}) =>
    fenceTopodMigrationSource({
      userDataPath,
      store,
      claims,
      targetId: TARGET.id,
      destinationEnvironmentId: 'env-1',
      destinationName: 'Managed',
      terminalProof: exited,
      ...overrides
    })
  const target = () => store.getSshTarget(TARGET.id)!
  return { userDataPath, dataFile, store, claims, fence, target }
}

describe('migration source fence', () => {
  it('keeps the journal out of the profile, where an older build would strip it', async () => {
    const harness = setup()
    const result = await harness.fence()
    if (result.outcome !== 'fenced') {
      throw new Error('expected a fence')
    }
    await harness.store.flushPendingOrThrowAsync()
    const journalDirectory = topodMigrationCutoverJournalDirectory(harness.userDataPath)
    const profileFiles = readdirSync(harness.userDataPath, { recursive: true, encoding: 'utf8' })
      .map((name) => join(harness.userDataPath, name))
      .filter((path) => !path.startsWith(journalDirectory) && statSync(path).isFile())
    expect(profileFiles.length).toBeGreaterThan(0)
    for (const path of profileFiles) {
      expect(readFileSync(path).includes(result.cutover.migrationId)).toBe(false)
    }
    const [onDisk] = listTopodMigrationSourceCutovers(harness.userDataPath)
    expect(onDisk).toMatchObject({ phase: 'source-fenced', sshTargetGeneration: 2 })
    expect(onDisk?.manifest.payload.repositories.map((repo) => repo.id)).toEqual(['repo-1'])
  })

  it('treats a fence whose journal was lost as unverifiable and never releases it', async () => {
    const harness = setup()
    await harness.fence()
    rmSync(topodMigrationCutoverJournalDirectory(harness.userDataPath), { recursive: true })
    expect(resolveTopodMigrationFence(harness.userDataPath, harness.target())).toEqual({
      state: 'fenced-unverifiable',
      environmentId: 'env-1'
    })
    await expect(harness.fence()).resolves.toMatchObject({
      outcome: 'refused',
      verdict: 'unverifiable',
      code: 'topod_migration_fenced_unverifiable'
    })
    expect(getManagedTopodFenceEnvironmentId(harness.target())).toBe('env-1')
  })

  it('fails closed on an unreadable journal', async () => {
    const harness = setup()
    await harness.fence()
    const [cutover] = listTopodMigrationSourceCutovers(harness.userDataPath)
    writeFileSync(
      join(
        topodMigrationCutoverJournalDirectory(harness.userDataPath),
        `${cutover!.migrationId}.json`
      ),
      '{not json'
    )
    expect(() => resolveTopodMigrationFence(harness.userDataPath, harness.target())).toThrow(
      'stays fenced'
    )
    await expect(harness.fence()).rejects.toThrow('stays fenced')
  })

  it('releases its own fence when a terminal appeared before the fence took hold', async () => {
    const harness = setup()
    const flush = vi.spyOn(harness.claims, 'flush').mockImplementation(async () => {
      if (harness.target().topodFence) {
        vi.spyOn(harness.store, 'getSshRemotePtyLeases').mockReturnValue([
          { targetId: TARGET.id, ptyId: 'late-pty', state: 'detached', createdAt: 1, updatedAt: 1 }
        ])
      }
    })
    await expect(harness.fence()).resolves.toMatchObject({ outcome: 'refused', verdict: 'live' })
    expect(harness.target().topodFence).toBeUndefined()
    expect(listTopodMigrationSourceCutovers(harness.userDataPath)).toEqual([])
    flush.mockRestore()
  })
})
