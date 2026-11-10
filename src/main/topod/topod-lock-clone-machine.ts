// Images cloned with one /etc/machine-id look like one machine to every PID check (#32918).
import { statSync } from 'node:fs'
import process from 'node:process'
import { TOPO_MACHINE_NAME_ENV } from '../../shared/topod-managed-launch-env'
import type { TopodPeerMachine } from './topod-lock-holder-locality'
import { currentLinuxBootStartedAtMs } from '../persistence/profile-state/profile-state-access-identity'

const CLONE_MACHINE_ID_HINT =
  'Machines cloned from one image share /etc/machine-id, so Topo cannot tell them apart. If the Topo ' +
  'on the clone crashed, a normal start takes over once its lock goes 5 minutes without a heartbeat. ' +
  'On the clone, run `sudo rm /etc/machine-id && sudo systemd-machine-id-setup` and reboot it.'
const CLONE_OWN_DATA_HINT =
  'Or, on that machine only, give Topo its own data: for Topo-managed SSH servers set ' +
  `${TOPO_MACHINE_NAME_ENV} where its non-interactive SSH logins read it (~/.zshenv, or above the ` +
  'interactive check in ~/.bashrc), guarded by a test that matches only that machine, since a ' +
  'shared home applies it everywhere; for `topo serve` set TOPO_USER_DATA.'

/** Lock heartbeats refresh the record's mtime well inside this window. */
export const TOPOD_LOCK_HEARTBEAT_MS = 60_000
export const TOPOD_LOCK_FRESH_MS = 5 * TOPOD_LOCK_HEARTBEAT_MS

/**
 * Images cloned with one /etc/machine-id (and often one hostname) differ only by boot. A record from
 * another boot is this machine's own unless it was written after this boot began; staleness lets a
 * crashed clone's record go. Hostnames are ignored: renames change them and clones repeat them.
 */
export function topodPeerIsLiveCloneMachine(
  peer: TopodPeerMachine,
  self: TopodPeerMachine,
  dataRootIsOnLocalDisk: () => boolean,
  platform: NodeJS.Platform = process.platform
): boolean {
  const { writtenAtMs } = peer
  const { bootStartedAtMs, nowMs } = self
  return (
    platform === 'linux' &&
    !!peer.machineIdentity &&
    peer.machineIdentity === self.machineIdentity &&
    !!peer.bootId &&
    !!self.bootId &&
    peer.bootId !== self.bootId &&
    writtenAtMs !== undefined &&
    bootStartedAtMs !== undefined &&
    nowMs !== undefined &&
    writtenAtMs > bootStartedAtMs &&
    nowMs - writtenAtMs < TOPOD_LOCK_FRESH_MS &&
    !dataRootIsOnLocalDisk()
  )
}

/** A heartbeat refreshes the lock file's mtime; the record's own time covers older versions. */
export function topodLockPeer(
  record: TopodPeerMachine & { acquiredAt: string },
  lockPath: string | null
): TopodPeerMachine {
  let mtimeMs = 0
  try {
    mtimeMs = lockPath === null ? 0 : statSync(lockPath).mtimeMs
  } catch {
    // A vanished lock leaves the record's own time.
  }
  const acquiredAtMs = Date.parse(record.acquiredAt)
  const writtenAtMs = Math.max(Number.isFinite(acquiredAtMs) ? acquiredAtMs : 0, mtimeMs)
  return { ...record, ...(writtenAtMs > 0 ? { writtenAtMs } : {}) }
}

/** This machine as judged against peers: its boot start dates records from earlier boots. */
export function topodLockSelf(
  self: TopodPeerMachine,
  nowMs: number,
  bootStartedAtMs: number | null = currentLinuxBootStartedAtMs()
): TopodPeerMachine {
  return { ...self, nowMs, ...(bootStartedAtMs === null ? {} : { bootStartedAtMs }) }
}

/** Beat well inside the freshness window so a machine sharing this machine-id can see the holder lives. */
export function startTopodLockHeartbeat(beat: () => void): () => void {
  const heartbeat = setInterval(beat, TOPOD_LOCK_HEARTBEAT_MS)
  heartbeat.unref()
  return () => clearInterval(heartbeat)
}

export function topodCloneMachineHint(role: 'topod' | 'desktop'): string {
  const ownData = role === 'desktop' ? '' : ` ${CLONE_OWN_DATA_HINT}`
  return `${CLONE_MACHINE_ID_HINT}${ownData}`
}
