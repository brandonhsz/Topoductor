/** Managed topod servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  TopodDeltaMovePreview,
  TopodDeltaMoveResult,
  TopodManagedCancelStopResult,
  TopodManagedConversionResult,
  TopodManagedDeployResult,
  TopodManagedForgetResult,
  TopodManagedPastLiveTerminals,
  TopodManagedPendingMigrationRow,
  TopodManagedRecoveryResult,
  TopodManagedRestartResult,
  TopodManagedStaleLockReclaimRequest,
  TopodManagedStaleLockReclaimResult,
  TopodManagedRollbackResult,
  TopodManagedRuntimeStatus,
  TopodManagedStopResult
} from '../../shared/topod-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../shared/runtime-ssh-access'

export type ManagedTopodPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<TopodManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<TopodManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: TopodManagedPastLiveTerminals
  }) => Promise<TopodManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<TopodManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see TOPOD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<TopodManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<TopodManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & TopodManagedStaleLockReclaimRequest
  ) => Promise<TopodManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<TopodManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<TopodManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<TopodManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<TopodManagedConversionResult>
  listPendingMigrations: () => Promise<TopodManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<TopodDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<TopodDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedTopodApi: ManagedTopodPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployTopod', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getTopodStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateTopod', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackTopod', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverTopod', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartTopod', args),
  reclaimStaleLock: (args) => ipcRenderer.invoke('runtimeEnvironments:reclaimTopodStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopTopod', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelTopodStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetTopod', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedTopod', args),
  listPendingMigrations: () => ipcRenderer.invoke('runtimeEnvironments:listPendingTopodMigrations'),
  previewDeltaMove: (args) => ipcRenderer.invoke('runtimeEnvironments:previewTopodDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveTopodDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepTopodServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowTopodMoveLeavingBehind', args)
}
