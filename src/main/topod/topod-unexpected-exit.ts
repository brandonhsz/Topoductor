import { uptime } from 'node:os'
import type { TopodUnexpectedExit } from '../../shared/topod-unexpected-exit'
import type { TopodLockRecord } from './topod-instance-lock'

/** A reclaimed topod lock from this boot means that run died; without boot evidence a reboot cannot be ruled out. */
export function reclaimedUnexpectedExit(
  holder: TopodLockRecord,
  self: Pick<TopodLockRecord, 'bootId'>,
  // Linux reads the kernel boot time; elsewhere the OS uptime gives it.
  bootStartedAtMs: number = Date.now() - uptime() * 1000
): TopodUnexpectedExit | null {
  const sameBoot =
    holder.bootId && self.bootId
      ? holder.bootId === self.bootId
      : Date.parse(holder.acquiredAt) >= bootStartedAtMs
  return holder.role !== 'desktop' && sameBoot
    ? { pid: holder.pid, version: holder.version, acquiredAt: holder.acquiredAt }
    : null
}

let previousUnexpectedExit: TopodUnexpectedExit | null = null
let runFailed = false

/** A fatal stop keeps the instance lock, so the next start reports this run as unexpected. */
export function markTopodRunFailed(): void {
  runFailed = true
}

export function topodRunFailed(): boolean {
  return runFailed
}

/** Set once from the startup lock acquisition, before readiness publishes health. */
export function recordTopodPreviousUnexpectedExit(exit: TopodUnexpectedExit | null): void {
  previousUnexpectedExit = exit
}

export function topodPreviousUnexpectedExit(): TopodUnexpectedExit | null {
  return previousUnexpectedExit
}
