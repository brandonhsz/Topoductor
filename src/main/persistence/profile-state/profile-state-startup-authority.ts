import type { AutomationStorageAuthority } from '../scheduling-automations/automation-owner-projection'
import { isProfileStateSqliteAvailable } from './profile-state-database'
import type {
  ProfileStateStoreFactoryOptions,
  ProfileStateStoreFactoryResult
} from './profile-state-store-factory'
import { createLiveProfileStateStore } from './profile-state-live-store-factory'

export type ProfileStateStartupRuntime = 'desktop' | 'topod'

export type ProfileStateStartupAuthorityOptions = Omit<
  ProfileStateStoreFactoryOptions,
  'storageAuthority'
> & {
  runtime: ProfileStateStartupRuntime
  storageAuthority: AutomationStorageAuthority
  onPersistenceFailure?: (error: Error) => void
  onPersistenceSaveDelayChanged?: (delayed: boolean) => void
  /** See ProfileStateWorkerAuthorityOptions.writerIdleStopMs. */
  writerIdleStopMs?: number
}

export class ProfileStateStartupAuthorityError extends Error {
  readonly code = 'topod-sqlite-authority-unsupported' as const

  constructor() {
    super(
      'topod requires SQLite database and backup support. Launch it through its pinned Node runtime.'
    )
    this.name = 'ProfileStateStartupAuthorityError'
  }
}

/** Desktop and topod share the validated authority boundary. */
export async function createProfileStateStoreForStartup(
  options: ProfileStateStartupAuthorityOptions
): Promise<ProfileStateStoreFactoryResult> {
  if (options.runtime === 'topod' && !isProfileStateSqliteAvailable()) {
    throw new ProfileStateStartupAuthorityError()
  }
  return createLiveProfileStateStore(options, {
    onSaveDelayChanged: options.onPersistenceSaveDelayChanged,
    writerIdleStopMs: options.writerIdleStopMs,
    onFailure:
      options.onPersistenceFailure ??
      ((error) =>
        console.error('[persistence] Saving has stopped. Restart Topo before continuing.', error))
  })
}
