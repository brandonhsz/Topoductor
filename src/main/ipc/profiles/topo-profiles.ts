import { ipcMain, type WebContents } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import { relaunchApp, type AppRelaunchReason } from '../../startup/quit/app-relaunch'
import { quitProcess } from '../../startup/process-quit-request'
import type {
  CreateLocalTopoProfileArgs,
  CreateLocalTopoProfileResult,
  CreateCloudLinkedTopoProfileArgs,
  CreateCloudLinkedTopoProfileResult,
  FindTopoProfileProjectsByPathArgs,
  FindTopoProfileProjectsByPathResult,
  TopoProfileListResult,
  RefreshCurrentTopoProfileAuthResult,
  SwitchTopoProfileArgs,
  SwitchTopoProfileResult,
  TransferTopoProfileProjectArgs,
  TransferTopoProfileProjectResult,
  ConnectCurrentTopoProfileResult,
  TopoProfileAuthStatus,
  TopoCloudSignInProgress,
  SelectTopoProfileOrgArgs,
  SelectTopoProfileOrgResult,
  SignOutCurrentTopoProfileResult
} from '../../../shared/topo-profiles'
import {
  createLocalTopoProfile,
  getTopoProfileListState,
  setActiveTopoProfile
} from '../../topo-profiles/profile-index-store'
import { initializeNewTopoProfileState } from '../../topo-profiles/new-profile-state'
import { getProfileUserDataPath } from '../../topo-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../../topo-profiles/profile-ui-scope'
import { transferTopoProfileProject } from '../../topo-profiles/profile-project-transfer'
import { transferActiveProfileProject } from '../../topo-profiles/profile-active-transfer'
import { findTopoProfileProjectsByPath } from '../../topo-profiles/profile-project-presence'
import {
  flushActiveProfileBeforeFileMutation,
  flushActiveProfileBeforeRelaunch
} from '../../topo-profiles/profile-persistence-deadline'
import { normalizeExecutionHostId } from '../../../shared/execution-host'
import {
  createCloudLinkedTopoProfile,
  connectCurrentTopoProfile,
  getCurrentTopoProfileAuthStatus,
  selectCurrentTopoProfileOrg,
  signOutCurrentTopoProfile
} from '../../topo-profiles/profile-cloud-service'
import { refreshCurrentTopoProfileAuth } from '../../topo-profiles/profile-cloud-capability-refresh'
import { registerTopoProfileOrgMemberHandlers } from './topo-profile-org-members-handlers'
import { onTopoCloudSessionInvalidated } from '../../topo-profiles/profile-cloud-session-invalidation'
import {
  broadcastTopoProfileAuthStatusChanged,
  broadcastTopoProfileSignInProgressChanged
} from './topo-profile-auth-status-broadcast'
import {
  cancelTopoCloudSignIn,
  getTopoCloudSignInProgress,
  onTopoCloudSignInProgressChanged
} from '../../topo-profiles/profile-cloud-sign-in-progress'
import { profileIdFromArgs } from './topo-profile-id-arg'
import { transferProjectArgsFromUnknown } from './topo-profile-project-transfer-args'

type RegisterTopoProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
  onAfterSignOut?: () => void
}

function findProjectsByPathArgsFromUnknown(args: unknown): FindTopoProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_topo_profile_project_path')
  }
  const candidate = args as FindTopoProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_topo_profile_project_path')
  }
  let executionHostId: FindTopoProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_topo_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_topo_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_topo_profile_org_selection')
  }
  const orgId = (args as SelectTopoProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_topo_profile_org_selection')
  }
  return orgId
}

function createCloudLinkedProfileArgsFromUnknown(args: unknown): CreateCloudLinkedTopoProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedTopoProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[topo-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

type ProfileRelaunchReason = Extract<AppRelaunchReason, `profile-${string}`>

function scheduleProfileRelaunch(reason: ProfileRelaunchReason, sender: WebContents): void {
  if (!sender.isDestroyed()) {
    sender.send('app:restart-committed')
  }
  setTimeout(() => {
    relaunchApp(reason)
    // Normal quit preserves renderer scrollback, PTY teardown, stats flush and final daemon checkpoints.
    quitProcess()
  }, 150)
}

export function registerTopoProfileHandlers(
  store: Store,
  options: RegisterTopoProfileHandlersOptions = {}
): void {
  ipcMain.handle('topoProfiles:list', (): TopoProfileListResult => ({
    ...getTopoProfileListState(),
    multiProfileUi: isMultiProfileUiEnabled()
  }))

  ipcMain.handle('topoProfiles:authStatus', (): TopoProfileAuthStatus =>
    getCurrentTopoProfileAuthStatus(getProfileUserDataPath())
  )

  // Push background invalidation; re-entering onAuthMutation would loop into the relay coordinator that just failed.
  onTopoCloudSessionInvalidated(broadcastTopoProfileAuthStatusChanged)
  onTopoCloudSignInProgressChanged(broadcastTopoProfileSignInProgressChanged)

  ipcMain.handle(
    'topoProfiles:createLocal',
    (_event, args?: CreateLocalTopoProfileArgs): CreateLocalTopoProfileResult => {
      const result = createLocalTopoProfile(args)
      initializeNewTopoProfileState(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'topoProfiles:switch',
    async (event, args: SwitchTopoProfileArgs): Promise<SwitchTopoProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getTopoProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      // Flush the source profile before switching the startup index; keep its writer alive through relaunch cleanup.
      await flushActiveProfileBeforeRelaunch(store)
      setActiveTopoProfile(profileId)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)

      scheduleProfileRelaunch('profile-switch', event.sender)

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'topoProfiles:transferProject',
    async (
      event,
      rawArgs: TransferTopoProfileProjectArgs
    ): Promise<TransferTopoProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getTopoProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_topo_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Finish transfer before relaunch side effects so validation failure cannot strand the app quitting.
        const result = await transferActiveProfileProject(
          args,
          getProfileUserDataPath(),
          store,
          async () => {
            await runBeforeProfileRelaunch(options.onBeforeRelaunch)
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
        )
        if (result.status === 'transferred') {
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          try {
            setActiveTopoProfile(args.targetProfileId)
          } finally {
            // The source has already changed and its writer cannot resume.
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
          return { ...result, willRelaunch: true }
        }
        return result
      }
      if (args.sourceProfileId !== current.activeProfileId) {
        await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        return transferTopoProfileProject(args, getProfileUserDataPath())
      }
      const maintenance = await flushActiveProfileBeforeFileMutation(store)
      try {
        return transferTopoProfileProject(args, getProfileUserDataPath())
      } finally {
        await maintenance.resume()
      }
    }
  )

  ipcMain.handle(
    'topoProfiles:findProjectProfiles',
    (_event, rawArgs: FindTopoProfileProjectsByPathArgs): FindTopoProfileProjectsByPathResult =>
      findTopoProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'topoProfiles:connectCurrent',
    async (): Promise<ConnectCurrentTopoProfileResult> => {
      const result = await connectCurrentTopoProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle('topoProfiles:signInProgress', (): TopoCloudSignInProgress | null =>
    getTopoCloudSignInProgress()
  )

  ipcMain.handle('topoProfiles:cancelSignIn', (): void => cancelTopoCloudSignIn())

  ipcMain.handle(
    'topoProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedTopoProfileArgs
    ): Promise<CreateCloudLinkedTopoProfileResult> => {
      const result = await createCloudLinkedTopoProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        initializeNewTopoProfileState(result.profile.id, store.getSettings().telemetry)
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'topoProfiles:refreshAuth',
    async (): Promise<RefreshCurrentTopoProfileAuthResult> => {
      const result = await refreshCurrentTopoProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'topoProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentTopoProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentTopoProfile(getProfileUserDataPath()).finally(options.onAfterSignOut)
    }
  )

  ipcMain.handle(
    'topoProfiles:selectOrg',
    async (_event, rawArgs: SelectTopoProfileOrgArgs): Promise<SelectTopoProfileOrgResult> => {
      const result = await selectCurrentTopoProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  registerTopoProfileOrgMemberHandlers()
}
