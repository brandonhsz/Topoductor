import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type TopoCloudSignInProgress,
  type TopoProfileListResult,
  type SwitchTopoProfileResult,
  type TransferTopoProfileProjectResult
} from '../../shared/topo-profiles'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const topoProfilesApi = {
  list: () => ipcRenderer.invoke('topoProfiles:list'),
  authStatus: () => ipcRenderer.invoke('topoProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(TOPO_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  onSignInProgressChanged: (
    callback: (progress: TopoCloudSignInProgress | null) => void
  ): (() => void) => {
    const listener = (_event: unknown, progress: TopoCloudSignInProgress | null): void =>
      callback(progress)
    ipcRenderer.on(TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(TOPO_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('topoProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('topoProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchTopoProfileResult> => ipcRenderer.invoke('topoProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferTopoProfileProjectResult> =>
      ipcRenderer.invoke('topoProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: TopoProfileListResult = await ipcRenderer.invoke('topoProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('topoProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('topoProfiles:connectCurrent'),
  signInProgress: () => ipcRenderer.invoke('topoProfiles:signInProgress'),
  cancelSignIn: () => ipcRenderer.invoke('topoProfiles:cancelSignIn'),
  refreshAuth: () => ipcRenderer.invoke('topoProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('topoProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('topoProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('topoProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('topoProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('topoProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('topoProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('topoProfiles:orgMemberRemove', args)
} satisfies PreloadApi['topoProfiles']
