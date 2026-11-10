import type { WslRunningDistrosRead } from '../discovery/wsl-background-distro-gate'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import type { WslTopodLaunch } from './wsl-topod-launch-contract'
import { confirmsRunning } from './wsl-topod-liveness-evidence'

type WslTopodDeferredLaunch = Extract<WslTopodLaunch, { outcome: 'deferred' }>

/** topod installed an update it may not activate yet (live terminals); nothing is listening. */
export class WslTopodLaunchDeferredError extends Error {
  constructor(readonly launch: WslTopodDeferredLaunch) {
    super(launch.reason)
    this.name = 'WslTopodLaunchDeferredError'
  }
}

/** A no-boot reconnect found the distro not confirmed running, so nothing was started. */
export class WslDistroNotRunningError extends Error {
  constructor(distro: string) {
    super(
      `The WSL distro ${distro} isn’t running, so Topo didn’t start it for a background request.`
    )
    this.name = 'WslDistroNotRunningError'
  }
}

/** A no-boot gate couldn't read WSL's running list: nothing was started, and the verdict is open. */
export class WslDistroUnverifiableConnectError extends Error {
  constructor(distro: string) {
    super(
      `WSL didn’t answer whether ${distro} is running, so Topo didn’t start anything there yet.`
    )
    this.name = 'WslDistroUnverifiableConnectError'
  }
}

/** True only for a confirmed running read; an unreadable list throws, never reading as "not running". */
export function requireConfirmedRunning(running: WslRunningDistrosRead, distro: string): boolean {
  if (running.status !== 'confirmed') {
    throw new WslDistroUnverifiableConnectError(distro)
  }
  return confirmsRunning(running, wslDistroHolderKey(distro))
}

export class WslTopodConnectionSupersededError extends Error {
  constructor(distro: string) {
    super(`The connection to the WSL distro ${distro} was closed while it was being opened.`)
    this.name = 'WslTopodConnectionSupersededError'
  }
}

/** A no-boot connect re-reads the running list just before anything spawns in the distro. */
export async function assertWslDistroMayStart(
  distro: string,
  requireRunning: ((distro: string) => Promise<boolean>) | undefined,
  isCurrent: () => boolean
): Promise<void> {
  if (!requireRunning) {
    return
  }
  const running = await requireRunning(distro)
  // A close during the read supersedes this connect before it deploys anything.
  if (!isCurrent()) {
    throw new WslTopodConnectionSupersededError(distro)
  }
  if (!running) {
    throw new WslDistroNotRunningError(distro)
  }
}

/** A no-boot gate refused before anything spawned: stopped, or the running list was unreadable. */
export function isNoBootRefusal(error: unknown): boolean {
  return (
    error instanceof WslDistroNotRunningError || error instanceof WslDistroUnverifiableConnectError
  )
}

/** Failures the connection's status must not report as `failed`: liveness owns those verdicts. */
export function isQuietConnectFailure(error: unknown): boolean {
  return error instanceof WslTopodConnectionSupersededError || isNoBootRefusal(error)
}
