import { ipcMain } from 'electron'
import type {
  TopodManagedConversionResult,
  TopodManagedPendingMigrationRow
} from '../../../shared/topod-managed-runtime'
import { listPendingManagedTopodMigrations } from '../../managed-server/lifecycle/topod-managed-migration-status'
import { convertSshTargetToManagedTopod } from '../../managed-server/lifecycle/topod-runtime-conversion'
import { conversionCollaborators } from '../../managed-server/lifecycle/topod-runtime-conversion-wiring'
import { requiredString } from './topod-runtime-lifecycle-handlers'

export function registerTopodRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedTopod',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<TopodManagedConversionResult> => {
      return convertSshTargetToManagedTopod(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingTopodMigrations',
    (): TopodManagedPendingMigrationRow[] => listPendingManagedTopodMigrations(getUserDataPath())
  )
}
