import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { getDefaultPersistedState } from '../../shared/constants'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { createInitialHomeWorkspaceState } from '../persistence/loading-store/initial-home-workspace'
import { LoadedCohortMigrationOperations } from '../persistence/loading-store/loaded-cohort-migrations'
import { acquireProfileStateRuntimeAdmission } from '../persistence/profile-state/profile-state-access'
import { isProfileStateSqliteAvailable } from '../persistence/profile-state/profile-state-database'
import { migrateProfileStateToSqlite } from '../persistence/profile-state/profile-state-migration'
import {
  getTopoProfileDataFile,
  getTopoProfileStateDatabaseFile,
  getProfileUserDataPath
} from './profile-storage-paths'

export function initializeNewTopoProfileState(
  profileId: string,
  telemetry: GlobalSettings['telemetry'],
  userDataPath = getProfileUserDataPath()
): void {
  if (!isProfileStateSqliteAvailable()) {
    throw new Error('Creating profile state requires the bundled Topo runtime.')
  }
  const admission = acquireProfileStateRuntimeAdmission(userDataPath)
  try {
    const dataFile = getTopoProfileDataFile(profileId, userDataPath)
    const databaseFile = getTopoProfileStateDatabaseFile(profileId, userDataPath)
    if (existsSync(dataFile) || existsSync(databaseFile)) {
      return
    }
    const defaults = getDefaultPersistedState(homedir())
    const cohorts = new LoadedCohortMigrationOperations({ loadNeedsSave: false })
    // Inherited consent belongs to an install that already existed, so its milestone cohort is not fresh.
    const initial = cohorts.migrateCohortSeeds(
      telemetry
        ? cohorts.migrateTelemetry(
            {
              ...defaults,
              settings: {
                ...defaults.settings,
                telemetry: { ...telemetry, protectedMilestones: { installCohort: 'existing' } }
              }
            },
            true
          )
        : cohorts.migrateTelemetry(defaults, false),
      false
    )
    const initialState = createInitialHomeWorkspaceState(initial)
    const migrated = migrateProfileStateToSqlite({
      dataFile,
      databaseFile,
      profileId,
      expectedLegacyJson: undefined,
      serializedState: JSON.stringify({
        ...initialState,
        chatUiLaunchTipAudience: cohorts.captureChatUiLaunchTipAudience(undefined)
      })
    })
    migrated.authority.close()
  } finally {
    admission.release()
  }
}
