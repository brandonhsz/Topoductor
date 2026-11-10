import { ipcMain } from 'electron'
import type { TopodManagedRuntimeStatus } from '../../../shared/topod-managed-runtime'
import { createManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-runtime-deployment'
import { getManagedTopodRuntimeStatus } from '../../managed-server/lifecycle/topod-runtime-status'

export function registerTopodRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployTopod',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedTopodEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getTopodStatus',
    (_event, args: { selector: string }): Promise<TopodManagedRuntimeStatus> =>
      getManagedTopodRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
