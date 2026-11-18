import { access, copyFile, cp, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../../filesystem/durable-file-write'
import { renameFileWithWindowsRetryAsync } from '../../../shared/windows-retry-file-operations'
import { MOBILE_PAIRING_USERDATA_FILES } from '../../runtime/rpc/server/pairing/mobile-pairing-files'
import { HOST_INSTALLATION_FILENAME } from '../../runtime/hosts/platform-probe/host-descriptor'
import { NETWORK_SOURCE_POLICY_FILE } from '../../runtime/rpc/server/network-source-policy-store'
import { PROFILE_STATE_DATABASE_FILE_NAME } from '../../../shared/profile-state-storage-paths'
import { profileStateAuthorityMarkerPath } from '../profile-state/profile-state-authority-marker'
import {
  getTopoProfileBrowserSessionMetaFile,
  getTopoProfileDataFile,
  getTopoProfileIndexPath,
  legacyDataFilePath
} from '../../topo-profiles/profile-storage-paths'
import { getSshHostKeyStoreFile } from '../../ssh/host-keys/ssh-host-key-store'
import {
  FutureOrcaProfileSchemaError,
  isMissingPath,
  snapshotOrcaDatabase,
  snapshotOrcaProfileStateDatabase
} from './orca-database-snapshot'

export const ORCA_USER_DATA_IMPORT_MARKER = 'orca-user-data-import.json'
const STAGING_DIR_NAME = '.orca-user-data-import-staging'

type ImportedEntryKind = 'file' | 'directory' | 'database' | 'profiles'

/** Only state Topo reads under these names; the profile index publishes last so a crash can resume. */
const IMPORTED_ENTRIES: readonly { orcaName: string; kind: ImportedEntryKind }[] = [
  { orcaName: 'agent-session-authority.key', kind: 'file' },
  { orcaName: 'agent-session-journal.db', kind: 'database' },
  { orcaName: 'agent-session-attachments', kind: 'directory' },
  { orcaName: 'agent-session-runtimes', kind: 'directory' },
  { orcaName: 'agent-model-catalog.db', kind: 'database' },
  { orcaName: 'orchestration.db', kind: 'database' },
  { orcaName: 'chat-scratch', kind: 'directory' },
  { orcaName: 'claude-observed-config-dirs.json', kind: 'file' },
  { orcaName: 'codex-pane-accounts.json', kind: 'file' },
  { orcaName: 'codex-runtime-home', kind: 'directory' },
  { orcaName: 'terminal-history', kind: 'directory' },
  { orcaName: 'orca-stats.json', kind: 'file' },
  { orcaName: 'profiles', kind: 'profiles' },
  { orcaName: 'orca-profile-index.json', kind: 'file' }
]

function profileFileNames(profileId: string): string[] {
  return [
    profileStateAuthorityMarkerPath(PROFILE_STATE_DATABASE_FILE_NAME),
    basename(getSshHostKeyStoreFile(getTopoProfileDataFile(profileId, ''))),
    basename(getTopoProfileBrowserSessionMetaFile(profileId, ''))
  ]
}

/**
 * Topo mints its own host identity, so pairing state keyed to Orca's identity stays behind;
 * users re-pair mobile devices with a topo:// link.
 */
export const PAIRING_BOUND_TOPO_NAMES: ReadonlySet<string> = new Set([
  ...MOBILE_PAIRING_USERDATA_FILES,
  HOST_INSTALLATION_FILENAME,
  NETWORK_SOURCE_POLICY_FILE,
  'mobile-notification-dismissals.db'
])

export type OrcaUserDataImportOutcome =
  | { status: 'already-imported' }
  | { status: 'skipped'; reason: 'orca-missing' | 'topo-has-data' | 'future-profile-schema' }
  | {
      status: 'imported'
      imported: string[]
      keptExisting: string[]
      excluded: string[]
      /** Orca's paired devices must pair again with Topo. */
      pairingLeftBehind: string[]
    }
  | { status: 'failed'; error: string }

export function orcaToTopoEntryName(orcaName: string): string {
  if (orcaName.startsWith('orcad-')) {
    return `topod-${orcaName.slice('orcad-'.length)}`
  }
  if (orcaName.startsWith('orca-')) {
    return `topo-${orcaName.slice('orca-'.length)}`
  }
  return orcaName
}

/** Copies Orca's state into an empty Topo userData once; never writes inside Orca's folder. */
export async function importOrcaUserDataOnFirstRun(paths: {
  orcaUserDataPath: string
  topoUserDataPath: string
}): Promise<OrcaUserDataImportOutcome> {
  const { orcaUserDataPath, topoUserDataPath } = paths
  const markerPath = join(topoUserDataPath, ORCA_USER_DATA_IMPORT_MARKER)
  if (await pathExists(markerPath)) {
    return { status: 'already-imported' }
  }
  const outcome = await runImport(orcaUserDataPath, topoUserDataPath)
  await mkdir(topoUserDataPath, { recursive: true, mode: 0o700 })
  await writeFileDurable(
    durableWriteTempPath(markerPath),
    markerPath,
    `${JSON.stringify({ version: 1, at: Date.now(), source: orcaUserDataPath, ...outcome }, null, 2)}\n`,
    0o600
  )
  return outcome
}

async function runImport(
  orcaUserDataPath: string,
  topoUserDataPath: string
): Promise<OrcaUserDataImportOutcome> {
  if (!(await pathExists(join(orcaUserDataPath, 'orca-profile-index.json')))) {
    return { status: 'skipped', reason: 'orca-missing' }
  }
  if (await hasTopoProfileState(topoUserDataPath)) {
    return { status: 'skipped', reason: 'topo-has-data' }
  }
  const stagingDir = join(topoUserDataPath, STAGING_DIR_NAME)
  try {
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(join(stagingDir, '.scratch'), { recursive: true, mode: 0o700 })
    // Profiles first: a future schema aborts before anything else is staged.
    const ordered = [...IMPORTED_ENTRIES].sort(
      (a, b) => Number(b.kind === 'profiles') - Number(a.kind === 'profiles')
    )
    const staged: string[] = []
    for (const entry of ordered) {
      const source = join(orcaUserDataPath, entry.orcaName)
      if (!(await pathExists(source))) {
        continue
      }
      await stageEntry(
        entry.kind,
        source,
        join(stagingDir, orcaToTopoEntryName(entry.orcaName)),
        stagingDir
      )
      staged.push(entry.orcaName)
    }
    const imported: string[] = []
    const keptExisting: string[] = []
    for (const entry of IMPORTED_ENTRIES) {
      if (!staged.includes(entry.orcaName)) {
        continue
      }
      const topoName = orcaToTopoEntryName(entry.orcaName)
      const target = join(topoUserDataPath, topoName)
      // Earlier startup steps may already own a name; never clobber Topo's own state.
      if (await pathExists(target)) {
        keptExisting.push(topoName)
        continue
      }
      await renameFileWithWindowsRetryAsync(join(stagingDir, topoName), target)
      imported.push(topoName)
    }
    const importedNames = new Set(IMPORTED_ENTRIES.map((entry) => entry.orcaName))
    const excluded = (await readdir(orcaUserDataPath)).filter((name) => !importedNames.has(name))
    const pairingLeftBehind = excluded.filter((name) =>
      PAIRING_BOUND_TOPO_NAMES.has(orcaToTopoEntryName(name))
    )
    return { status: 'imported', imported, keptExisting, excluded, pairingLeftBehind }
  } catch (error) {
    if (error instanceof FutureOrcaProfileSchemaError) {
      console.warn(`[orca-import] Skipping import: ${error.message}`)
      return { status: 'skipped', reason: 'future-profile-schema' }
    }
    console.error('[orca-import] Import from Orca failed; starting with a fresh profile:', error)
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function stageEntry(
  kind: ImportedEntryKind,
  source: string,
  target: string,
  stagingDir: string
): Promise<void> {
  const scratchDir = join(stagingDir, '.scratch')
  if (kind === 'file') {
    await copyFile(source, target, constants.COPYFILE_EXCL)
  } else if (kind === 'database') {
    await snapshotOrcaDatabase(source, target, scratchDir)
  } else if (kind === 'directory') {
    await copyDirectory(source, target)
  } else {
    await stageProfiles(source, target, scratchDir)
  }
}

async function stageProfiles(source: string, target: string, scratchDir: string): Promise<void> {
  await mkdir(target, { mode: 0o700 })
  for (const profile of await readdir(source, { withFileTypes: true })) {
    if (!profile.isDirectory()) {
      continue
    }
    const sourceProfile = join(source, profile.name)
    const targetProfile = join(target, profile.name)
    await mkdir(targetProfile, { mode: 0o700 })
    // Rotated profile-state backups are left behind; Topo starts its own rotation.
    const database = join(sourceProfile, PROFILE_STATE_DATABASE_FILE_NAME)
    if (await pathExists(database)) {
      await snapshotOrcaProfileStateDatabase(
        database,
        join(targetProfile, PROFILE_STATE_DATABASE_FILE_NAME),
        scratchDir
      )
    }
    for (const name of profileFileNames(profile.name)) {
      await copyFile(join(sourceProfile, name), join(targetProfile, name)).catch(
        (error: unknown) => {
          if (!isMissingPath(error)) {
            throw error
          }
        }
      )
    }
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    // Sockets and pipes belong to Orca's live processes and cannot be copied.
    filter: async (path) => {
      const stats = await lstat(path)
      return !stats.isSocket() && !stats.isFIFO()
    }
  })
}

async function hasTopoProfileState(topoUserDataPath: string): Promise<boolean> {
  return (
    (await pathExists(getTopoProfileIndexPath(topoUserDataPath))) ||
    (await pathExists(legacyDataFilePath(topoUserDataPath)))
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isMissingPath(error)) {
      return false
    }
    throw error
  }
}
