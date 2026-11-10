import { createProfileStateStoreForStartup } from '../persistence/profile-state/profile-state-startup-authority'
import type { ProfileStateStoreFactoryResult } from '../persistence/profile-state/profile-state-store-factory'
import { ensureActiveTopoProfile, initTopoProfilePaths } from '../topo-profiles/profile-index-store'
import { initSshHostKeyStoreFile } from '../ssh/host-keys/ssh-host-key-store'
import { initTopodHeldFenceTokenFile } from '../managed-server/activation/topod-held-fence-tokens'
import { emitTopodProfileStateAuthoritySelected } from './topod-profile-state-telemetry'
import { isWslHostTopodProcess } from '../ipc/wsl-guest-windows-drive-path'

/** WSL hosts are held to a per-distro memory budget; the idle writer thread costs ~13-15 MB. */
export const WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS = 60_000

/** SSH hosts and the desktop keep their writer thread running. */
export function topodProfileWriterIdleStopMs(
  isWslHost: () => boolean = isWslHostTopodProcess
): number | undefined {
  return isWslHost() ? WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS : undefined
}

type TopodProfileStateStartup = {
  store: ProfileStateStoreFactoryResult['store']
  authority: {
    backend: ProfileStateStoreFactoryResult['backend']
    classification: ProfileStateStoreFactoryResult['classification']
    authority_mode: 'sqlite-established'
    runtime: 'topod'
    migrated: boolean
  }
}

export async function createTopodProfileStateStartup(
  userDataPath: string
): Promise<TopodProfileStateStartup> {
  initTopoProfilePaths()
  const profile = ensureActiveTopoProfile(userDataPath)
  // Real persistence avoids falsely empty RPCs; headless authority keeps automations owned by this host.
  const result = await createProfileStateStoreForStartup({
    userDataPath,
    dataFile: profile.dataFile,
    databaseFile: profile.stateDatabaseFile,
    profileId: profile.profile.id,
    runtime: 'topod',
    storageAuthority: 'runtime',
    writerIdleStopMs: topodProfileWriterIdleStopMs()
  })
  const authority = {
    backend: result.backend,
    classification: result.classification,
    authority_mode: 'sqlite-established' as const,
    runtime: 'topod' as const,
    migrated: result.migrated
  }
  try {
    initSshHostKeyStoreFile(profile.dataFile)
    initTopodHeldFenceTokenFile(profile.dataFile)
    emitTopodProfileStateAuthoritySelected(authority)
    return { store: result.store, authority }
  } catch (error) {
    try {
      await result.store.freezeWritesAsync()
    } catch (closeError) {
      console.error(
        '[persistence] Failed to close profile persistence after startup failure:',
        closeError
      )
    }
    throw error
  }
}
