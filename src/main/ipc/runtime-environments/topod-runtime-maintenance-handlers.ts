import { ipcMain } from 'electron'
import { registerManagedServerActions } from '../../runtime/hosts/management/managed-server-actions-registry'
import {
  createManagedTopodActions,
  reclaimManagedTopodStaleLock,
  restartManagedTopod,
  type ManagedTopodActionOptions
} from './managed-topod-actions'
import { requiredString } from './topod-runtime-lifecycle-handlers'

export function registerTopodRuntimeMaintenanceHandlers(options: ManagedTopodActionOptions): void {
  const actions = createManagedTopodActions(options)
  // CLI runtime RPC uses these same managedServer actions.
  registerManagedServerActions(actions)
  ipcMain.handle(
    'runtimeEnvironments:updateTopod',
    async (
      _event,
      args: {
        selector: string
        force?: boolean
        pastLiveTerminals?: { incumbentVersion?: unknown }
      }
    ) => {
      const incumbentVersion = args?.pastLiveTerminals?.incumbentVersion
      const pastLiveTerminals =
        args?.pastLiveTerminals &&
        (typeof incumbentVersion === 'string' || incumbentVersion === null)
          ? { incumbentVersion }
          : undefined
      return actions.update(
        requiredString(args?.selector, 'Server'),
        args?.force === true,
        pastLiveTerminals
      )
    }
  )
  ipcMain.handle('runtimeEnvironments:rollbackTopod', async (_event, args: { selector: string }) =>
    actions.rollback(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:recoverTopod',
    async (_event, args: { selector: string; acceptChangedState?: boolean }) =>
      actions.recover(requiredString(args?.selector, 'Server'), args?.acceptChangedState === true)
  )
  ipcMain.handle('runtimeEnvironments:restartTopod', async (_event, args: { selector: string }) =>
    restartManagedTopod(options, requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:reclaimTopodStaleLock',
    async (_event, args: { selector: string; yes?: boolean; expectNonce?: string }) =>
      reclaimManagedTopodStaleLock(
        options,
        requiredString(args?.selector, 'Server'),
        // A confirmation without the checked record's nonce could clear a lock written since.
        args?.yes === true
          ? { yes: true, expectNonce: requiredString(args.expectNonce, 'The checked lock') }
          : { yes: false }
      )
  )
  ipcMain.handle('runtimeEnvironments:stopTopod', async (_event, args: { selector: string }) =>
    actions.stop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:cancelTopodStop',
    async (_event, args: { selector: string }) =>
      actions.cancelStop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle('runtimeEnvironments:forgetTopod', async (_event, args: { selector: string }) =>
    actions.forget(requiredString(args?.selector, 'Server'))
  )
}
