import process from 'node:process'
import { profileStateAccessMachineIdentity } from '../persistence/profile-state/profile-state-access-identity'
import { readTopodProcessIncarnation } from './topod-process-start-time'
import { TopodInstanceLockError } from './topod-data-root-privacy'
import { topodCloneMachineHint, topodPeerIsLiveCloneMachine } from './topod-lock-clone-machine'
import {
  topodStaleLockReclaimCommand,
  type TopodReclaimHintRuntime
} from '../../shared/topod-stale-lock-reclaim'

/** Match machine identity, then legacy boot identity; identity-less records require local-only storage. */
export function topodLockHolderLocality(
  holder: TopodPeerMachine,
  self: TopodPeerMachine,
  dataRootIsOnLocalDisk: () => boolean,
  platform: NodeJS.Platform = process.platform
): 'local' | 'foreign' | 'unknown' {
  if (holder.machineIdentity && self.machineIdentity) {
    if (holder.machineIdentity !== self.machineIdentity) {
      return 'foreign'
    }
    return topodPeerIsLiveCloneMachine(holder, self, dataRootIsOnLocalDisk, platform)
      ? 'unknown'
      : 'local'
  }
  if (holder.bootId && holder.bootId === self.bootId) {
    return 'local'
  }
  return dataRootIsOnLocalDisk() ? 'local' : 'unknown'
}

export type TopodPeerMachine = {
  machineIdentity?: string
  bootId?: string
  /** Latest of the record's own timestamp and its heartbeat mtime. */
  writtenAtMs?: number
  bootStartedAtMs?: number
  nowMs?: number
}

export function currentTopodPeerMachine(): TopodPeerMachine {
  const machineIdentity = profileStateAccessMachineIdentity()
  const bootId = readTopodProcessIncarnation(process.pid)?.bootId
  return { ...(machineIdentity ? { machineIdentity } : {}), ...(bootId ? { bootId } : {}) }
}

/** PIDs require a provable machine and boot match; unknown peers are never assumed exited. */
export function topodPeerPidIsJudgeableHere(
  peer: TopodPeerMachine,
  self: TopodPeerMachine,
  dataRootIsOnLocalDisk: () => boolean
): boolean {
  if (peer.bootId && self.bootId && peer.bootId !== self.bootId) {
    return false
  }
  return topodLockHolderLocality(peer, self, dataRootIsOnLocalDisk) === 'local'
}

export function topodLockHolderUnverifiableError(lock: {
  holder: string
  foreign: boolean
  /** The holder runs on another machine that reports this machine-id. */
  cloneMachine?: { role: 'topod' | 'desktop' }
  dataRoot: string
  lockPath: string
  /** Managed hosts may lack launchers on PATH, so name this runtime/entry in reclaim hints. */
  hintRuntime: TopodReclaimHintRuntime | null
}): TopodInstanceLockError {
  const command = topodStaleLockReclaimCommand(lock.dataRoot, lock.hintRuntime)
  const reclaim =
    process.platform === 'linux'
      ? `run \`${command}\` on the machine it ran on to check and clear it, or `
      : ''
  const cloneHint = lock.cloneMachine ? ` ${topodCloneMachineHint(lock.cloneMachine.role)}` : ''
  return new TopodInstanceLockError(
    'topod_instance_lock_holder_unverifiable',
    `${lock.holder} holds the data root ${lock.dataRoot}${lock.foreign || lock.cloneMachine ? ' from another machine' : ''}. ` +
      'Topo cannot check from here whether it is still running, because this data root may be ' +
      `shared with other machines. Stop it there. If it is not running anywhere, ${reclaim}` +
      `delete ${lock.lockPath} once you are sure.${cloneHint}`
  )
}
