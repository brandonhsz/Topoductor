/**
 * Lets a WSL distro stop once its topod idle-stops with nothing left to keep (R40). The desktop's
 * holder keeps the distro up; it reads this request and ends after topod's pid exits.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { TOPOD_WSL_HOLDER_RELEASE_FILENAME } from '../../shared/topod-idle-exit'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import { TOPOD_WSL_HOST_ENV } from '../ipc/wsl-guest-windows-drive-path'
import type { TopodDaemonRetirement } from './topod-daemon-retirement'

export function topodWslHolderReleasePath(userDataPath: string): string {
  return join(userDataPath, TOPOD_WSL_HOLDER_RELEASE_FILENAME)
}

/**
 * Only a WSL-host launch has a holder, and only a daemon that proved itself empty and left shows
 * no terminal would die with the distro. Why the launch marker: a setsid'd topod may lack WSL_DISTRO_NAME.
 */
export function idleStopMayReleaseWslHolder(
  env: NodeJS.ProcessEnv,
  daemon: TopodDaemonRetirement
): boolean {
  return env[TOPOD_WSL_HOST_ENV] === '1' && daemon.retirement === 'retired'
}

export function requestTopodWslHolderRelease(userDataPath: string, pid = process.pid): void {
  writeSecureFile(topodWslHolderReleasePath(userDataPath), `${pid}\n`)
}

/**
 * A starting topod may be given work, so any earlier request no longer stands. WSL-host launches
 * only; never throws, so a locked or unwritable data root cannot fail a start or a stop.
 */
export function withdrawTopodWslHolderRelease(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env[TOPOD_WSL_HOST_ENV] !== '1') {
    return
  }
  try {
    rmSync(topodWslHolderReleasePath(userDataPath), { force: true })
  } catch (error) {
    console.error('[topod] could not withdraw the WSL holder release request:', error)
  }
}
