import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import { openProfileStateDatabase } from '../profile-state/profile-state-database'
import { PROFILE_STATE_DATABASE_SCHEMA_VERSION } from '../profile-state/profile-state-database-schema'
import { getTopoProfileIndexPath } from '../../topo-profiles/profile-storage-paths'
import { MOBILE_PAIRING_USERDATA_FILES } from '../../runtime/rpc/server/pairing/mobile-pairing-files'
import {
  importOrcaUserDataOnFirstRun,
  orcaToTopoEntryName,
  ORCA_USER_DATA_IMPORT_MARKER
} from './orca-user-data-import'
import { resolveOrcaUserDataPath } from '../../startup/orca-user-data-import-startup'

vi.mock('electron', () => ({ app: {} }))

const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createUserDataDirs(): { orca: string; topo: string } {
  const root = mkdtempSync(join(tmpdir(), 'orca-user-data-import-'))
  directories.push(root)
  return { orca: join(root, 'orca'), topo: join(root, 'topo') }
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function createOrcaProfileDatabase(orca: string, keepOpen = false): Database.Database | null {
  const databasePath = join(orca, 'profiles', 'local-default', 'profile-state.db')
  mkdirSync(join(databasePath, '..'), { recursive: true })
  const { db } = openProfileStateDatabase(databasePath, 'local-default')
  db.exec(`CREATE TABLE orca_marker (value TEXT); INSERT INTO orca_marker VALUES ('kept');`)
  if (keepOpen) {
    return db
  }
  db.close()
  return null
}

function createWalDatabase(path: string, keepOpen = false): Database.Database | null {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('wal_autocheckpoint = 0')
  db.exec(`CREATE TABLE rows (value TEXT); INSERT INTO rows VALUES ('from-wal');`)
  if (keepOpen) {
    return db
  }
  db.close()
  return null
}

function seedOrca(orca: string): void {
  write(
    join(orca, 'orca-profile-index.json'),
    JSON.stringify({ schemaVersion: 1, activeProfileId: 'local-default', profiles: [] })
  )
  write(join(orca, 'orca-stats.json'), '{"stats":1}')
  write(join(orca, 'orca-devices.json'), '[]')
  write(join(orca, 'orca-e2ee-keypair.json'), '{}')
  write(join(orca, 'orca-runtime.json'), '{}')
  write(join(orca, 'orca-secret-protection.json'), '{}')
  write(join(orca, 'host-installation.json'), '{}')
  write(join(orca, 'runtime-network-source-policy.json'), '{}')
  write(join(orca, 'orcad.lock'), 'pid')
  write(join(orca, 'codex-pane-accounts.json'), '{"version":2}')
  write(join(orca, 'agent-session-authority.key'), 'key')
  write(join(orca, 'terminal-history', 'session-1', 'output.log'), 'scrollback')
  write(join(orca, 'chat-scratch', 'chat', 'note.md'), 'scratch')
  write(join(orca, 'orcad-artifacts', 'big.bin'), 'cache')
  write(join(orca, 'daemon', 'state.json'), '{}')
  write(join(orca, 'logs', 'main.log'), 'log')
  write(join(orca, '.profile-state-access', 'owner'), 'orca')
  write(join(orca, 'claude-agent-view', 'v1', 'orca-agent-view', 'plugin.json'), '{}')
  const profile = join(orca, 'profiles', 'local-default')
  write(join(profile, 'profile-state.db.authority'), 'sqlite\n')
  write(join(profile, 'ssh-host-keys.json'), '{}')
  write(join(profile, 'profile-state.db.backup.1-abc.db'), 'old')
  write(join(profile, 'orca-secret-protection.json'), '{}')
}

function listOrcaTree(orca: string): string[] {
  return readdirSync(orca, { recursive: true }).map(String).sort()
}

describe('importOrcaUserDataOnFirstRun', () => {
  it('imports Orca state with Topo names and leaves Orca untouched', async () => {
    const { orca, topo } = createUserDataDirs()
    createOrcaProfileDatabase(orca)
    seedOrca(orca)
    createWalDatabase(join(orca, 'orchestration.db'))
    const orcaTreeBefore = listOrcaTree(orca)

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome.status).toBe('imported')
    expect(listOrcaTree(orca)).toEqual(orcaTreeBefore)
    expect(readFileSync(join(topo, 'topo-stats.json'), 'utf8')).toBe('{"stats":1}')
    expect(existsSync(getTopoProfileIndexPath(topo))).toBe(true)
    expect(readFileSync(join(topo, 'terminal-history', 'session-1', 'output.log'), 'utf8')).toBe(
      'scrollback'
    )
    expect(readFileSync(join(topo, 'chat-scratch', 'chat', 'note.md'), 'utf8')).toBe('scratch')
    expect(existsSync(join(topo, 'codex-pane-accounts.json'))).toBe(true)
    expect(existsSync(join(topo, 'agent-session-authority.key'))).toBe(true)

    const profile = join(topo, 'profiles', 'local-default')
    expect(readdirSync(profile).sort()).toEqual([
      'profile-state.db',
      'profile-state.db.authority',
      'ssh-host-keys.json'
    ])
    const imported = new Database(join(profile, 'profile-state.db'), { readonly: true })
    expect(imported.prepare('SELECT value FROM orca_marker').get()).toEqual({ value: 'kept' })
    imported.close()

    expect(readdirSync(topo).some((name) => name.endsWith('-wal') || name.endsWith('-shm'))).toBe(
      false
    )
    const orchestration = new Database(join(topo, 'orchestration.db'), { readonly: true })
    expect(orchestration.prepare('SELECT value FROM rows').get()).toEqual({ value: 'from-wal' })
    orchestration.close()

    const marker = JSON.parse(readFileSync(join(topo, ORCA_USER_DATA_IMPORT_MARKER), 'utf8'))
    expect(marker).toMatchObject({ version: 1, status: 'imported', source: orca })
  })

  it('maps orca-prefixed names to the names Topo reads', () => {
    expect(orcaToTopoEntryName('orca-profile-index.json')).toBe(
      basename(getTopoProfileIndexPath('/'))
    )
    expect(orcaToTopoEntryName('orca-stats.json')).toBe('topo-stats.json')
    expect(orcaToTopoEntryName('orca-devices.json')).toBe(MOBILE_PAIRING_USERDATA_FILES[0])
    expect(orcaToTopoEntryName('orca-e2ee-keypair.json')).toBe(MOBILE_PAIRING_USERDATA_FILES[1])
    expect(orcaToTopoEntryName('orcad-artifacts')).toBe('topod-artifacts')
    expect(orcaToTopoEntryName('terminal-history')).toBe('terminal-history')
  })

  it('leaves process-bound, sealed, cached and pairing state behind', async () => {
    const { orca, topo } = createUserDataDirs()
    seedOrca(orca)

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    for (const name of [
      'topo-devices.json',
      'topo-e2ee-keypair.json',
      'topo-runtime.json',
      'topo-secret-protection.json',
      'host-installation.json',
      'runtime-network-source-policy.json',
      'orcad.lock',
      'topod.lock',
      'orcad-artifacts',
      'topod-artifacts',
      'daemon',
      'logs',
      '.profile-state-access',
      'claude-agent-view'
    ]) {
      expect(existsSync(join(topo, name)), name).toBe(false)
    }
    expect(outcome).toMatchObject({
      status: 'imported',
      pairingLeftBehind: expect.arrayContaining([
        'orca-devices.json',
        'orca-e2ee-keypair.json',
        'host-installation.json',
        'runtime-network-source-policy.json'
      ])
    })
  })

  it('snapshots a database Orca still has open, including uncheckpointed WAL frames', async () => {
    const { orca, topo } = createUserDataDirs()
    const profileDb = createOrcaProfileDatabase(orca, true)
    seedOrca(orca)
    const journal = createWalDatabase(join(orca, 'agent-session-journal.db'), true)
    try {
      const outcome = await importOrcaUserDataOnFirstRun({
        orcaUserDataPath: orca,
        topoUserDataPath: topo
      })
      expect(outcome.status).toBe('imported')
      const copy = new Database(join(topo, 'agent-session-journal.db'), { readonly: true })
      expect(copy.prepare('SELECT value FROM rows').get()).toEqual({ value: 'from-wal' })
      copy.close()
      const profileCopy = new Database(
        join(topo, 'profiles', 'local-default', 'profile-state.db'),
        {
          readonly: true
        }
      )
      expect(profileCopy.pragma('integrity_check', { simple: true })).toBe('ok')
      profileCopy.close()
    } finally {
      profileDb?.close()
      journal?.close()
    }
  })

  it('skips the whole import when Orca has a newer profile schema', async () => {
    const { orca, topo } = createUserDataDirs()
    createOrcaProfileDatabase(orca)
    seedOrca(orca)
    const db = new Database(join(orca, 'profiles', 'local-default', 'profile-state.db'))
    db.pragma(`user_version = ${PROFILE_STATE_DATABASE_SCHEMA_VERSION + 1}`)
    db.close()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome).toEqual({ status: 'skipped', reason: 'future-profile-schema' })
    expect(readdirSync(topo)).toEqual([ORCA_USER_DATA_IMPORT_MARKER])
  })

  it('does nothing when Topo already has a profile', async () => {
    const { orca, topo } = createUserDataDirs()
    seedOrca(orca)
    write(getTopoProfileIndexPath(topo), '{"topo":true}')

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome).toEqual({ status: 'skipped', reason: 'topo-has-data' })
    expect(readFileSync(getTopoProfileIndexPath(topo), 'utf8')).toBe('{"topo":true}')
    expect(existsSync(join(topo, 'topo-stats.json'))).toBe(false)
  })

  it('never runs again once the marker exists', async () => {
    const { orca, topo } = createUserDataDirs()
    seedOrca(orca)
    await importOrcaUserDataOnFirstRun({ orcaUserDataPath: orca, topoUserDataPath: topo })
    rmSync(getTopoProfileIndexPath(topo))
    rmSync(join(topo, 'topo-stats.json'))

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome).toEqual({ status: 'already-imported' })
    expect(existsSync(join(topo, 'topo-stats.json'))).toBe(false)
  })

  it('records a no-op when Orca was never installed', async () => {
    const { orca, topo } = createUserDataDirs()

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome).toEqual({ status: 'skipped', reason: 'orca-missing' })
    expect(existsSync(orca)).toBe(false)
    expect(readdirSync(topo)).toEqual([ORCA_USER_DATA_IMPORT_MARKER])
  })

  it('keeps entries Topo created earlier in startup', async () => {
    const { orca, topo } = createUserDataDirs()
    seedOrca(orca)
    write(join(topo, 'topo-stats.json'), '{"topo":1}')

    const outcome = await importOrcaUserDataOnFirstRun({
      orcaUserDataPath: orca,
      topoUserDataPath: topo
    })

    expect(outcome).toMatchObject({ status: 'imported', keptExisting: ['topo-stats.json'] })
    expect(readFileSync(join(topo, 'topo-stats.json'), 'utf8')).toBe('{"topo":1}')
  })
})

describe('resolveOrcaUserDataPath', () => {
  const base = {
    isPackaged: true,
    isE2E: false,
    getAppDataPath: () => join('/', 'app-data'),
    topoUserDataPath: join('/', 'app-data', 'topo')
  }

  it('looks beside the packaged Topo userData', () => {
    expect(resolveOrcaUserDataPath(base)).toBe(join('/', 'app-data', 'orca'))
  })

  it('never imports into dev, e2e or relocated profiles', () => {
    expect(resolveOrcaUserDataPath({ ...base, isPackaged: false })).toBeNull()
    expect(resolveOrcaUserDataPath({ ...base, isE2E: true })).toBeNull()
    expect(
      resolveOrcaUserDataPath({ ...base, topoUserDataPath: join('/', 'elsewhere', 'topo') })
    ).toBeNull()
  })
})
