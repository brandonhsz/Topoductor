/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  topodActivationFenceExists,
  withStaleTopodActivationRecoveryLock,
  type TopodActivationLockOptions
} from './topod-activation-lock'
import { readTopodActivationTransaction } from './topod-activation-transaction-store'
import { topodActivationFenceLockDir } from './topod-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from './topod-exited-own-lock'
import { topodRemoteBaseDir } from '../install/topod-remote-windows-node'

export const TOPOD_ACTIVATION_FENCE_BUSY_CODE = 'topod_activation_fence_busy'
const TOPOD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'topod_activation_recovery_required'

type TopodActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function topodActivationFenceRefusal(
  options: TopodActivationLockOptions,
  attempt: string
): Promise<TopodActivationFenceRefusal> {
  const lockDir = topodActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readTopodActivationTransaction(options).catch(() => null)) !== null
  const baseDir = topodRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: TOPOD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck = stale || (journal && !(await topodActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: TOPOD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: TOPOD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s Topo server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: TopodActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleTopodActivationRecoveryLock(options, async (lock) => {
      if (await readTopodActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
