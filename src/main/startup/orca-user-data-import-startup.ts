import { app } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { importOrcaUserDataOnFirstRun } from '../persistence/importing-orca-user-data/orca-user-data-import'
import { ensureActiveTopoProfile } from '../topo-profiles/profile-index-store'
import { getProfileUserDataPath } from '../topo-profiles/profile-storage-paths'
import { getMainE2EConfig } from './testing/e2e-config'

/** Orca's userData sits beside Topo's under appData; dev, e2e and custom profiles never import. */
export function resolveOrcaUserDataPath(input: {
  isPackaged: boolean
  isE2E: boolean
  getAppDataPath: () => string
  topoUserDataPath: string
  platform?: NodeJS.Platform
}): string | null {
  if (!input.isPackaged || input.isE2E) {
    return null
  }
  const normalize = (path: string): string =>
    (input.platform ?? process.platform) === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  const appDataPath = input.getAppDataPath()
  if (normalize(dirname(input.topoUserDataPath)) !== normalize(appDataPath)) {
    return null
  }
  return join(appDataPath, 'orca')
}

/** Imports first: once the profile index exists, Topo's fresh profile blocks the import. */
export async function ensureActiveTopoProfileAfterOrcaImport(): Promise<
  ReturnType<typeof ensureActiveTopoProfile>
> {
  await importOrcaUserDataAtStartup(getProfileUserDataPath())
  return ensureActiveTopoProfile()
}

async function importOrcaUserDataAtStartup(topoUserDataPath: string): Promise<void> {
  const orcaUserDataPath = resolveOrcaUserDataPath({
    isPackaged: app.isPackaged,
    isE2E: getMainE2EConfig().userDataDir !== null,
    getAppDataPath: () => app.getPath('appData'),
    topoUserDataPath
  })
  if (!orcaUserDataPath) {
    return
  }
  try {
    const outcome = await importOrcaUserDataOnFirstRun({ orcaUserDataPath, topoUserDataPath })
    if (outcome.status !== 'already-imported') {
      console.info('[orca-import] First-run import from Orca:', outcome)
    }
  } catch (error) {
    // Without a marker the next launch retries, unless Topo has created its own profile by then.
    console.error('[orca-import] Orca import did not complete:', error)
  }
}
