// Retain journal and fence until one serving slot is proven; release removes both, while only recovery may take retained state over.
import { randomUUID } from 'node:crypto'
import {
  execTopodRemote,
  withoutAbortSignal,
  type TopodRemoteExecTarget
} from '../install/topod-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { acquireInstallLock, RemoteInstallLockBusyError } from '../install/remote-install-lock'
import {
  orphanInstallLockCommand,
  probeInstallLockExistsCommand
} from '../install/remote-install-lock-commands'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  TOPOD_FENCE_OWNER_FILENAME,
  posixTopodFenceOwnedTest,
  runWithTopodFence,
  type TopodFence
} from './topod-activation-fence-scope'
import { topodRemoteBaseDir, topodWindowsHomeOpCommand } from '../install/topod-remote-windows-node'
import { forgetHeldTopodFence, rememberHeldTopodFence } from './topod-held-fence-tokens'
import { exitedOwnLockProof } from './topod-exited-own-lock'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import {
  topodActivationFenceLockDir,
  topodActivationTransactionPath,
  topodActivationTransactionRoot
} from './topod-activation-transaction'
import {
  readTopodActivationTransaction,
  writeTopodActivationTransaction
} from './topod-activation-transaction-store'

const TOPOD_ACTIVATION_MAX_READINESS_TIMEOUT_MS = 5 * 60_000

export type TopodActivationLockOptions = TopodRemoteExecTarget & { remoteHome: string }

export type TopodActivationLockControl = {
  /** Retain on throw once a journal describes possibly changed host state. */
  retainOnError(): void
  /** Retain on success too when serving-slot ownership remains unproven. */
  retain(): void
  /** Release even on later throw once the recorded slot is proven restored. */
  recovered(): void
}

/** Bound readiness below the stale-lock window so live waiters do not look abandoned. */
export function resolveTopodActivationReadinessTimeout(
  configured: number | undefined,
  fallback: number
): number {
  const timeout = configured ?? fallback
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > TOPOD_ACTIVATION_MAX_READINESS_TIMEOUT_MS
  ) {
    throw new Error(
      `topod readiness timeout must be an integer from 1 to ${TOPOD_ACTIVATION_MAX_READINESS_TIMEOUT_MS}ms`
    )
  }
  return timeout
}

// Tolerate brief concurrent work without stalling the lifecycle queue for a full stale window.
const TOPOD_ACTIVATION_FENCE_WAIT_MS = 5_000

/** Report held after a brief wait; token identifies this generation for subsequent recovery proof. */
export async function withTopodActivationLock<T>(
  options: TopodActivationLockOptions,
  run: (control: TopodActivationLockControl) => Promise<T>,
  held: () => T | Promise<T>,
  token: string = randomUUID()
): Promise<T> {
  const lockRoot = topodActivationTransactionRoot(options.host, options.remoteHome)
  rememberHeldTopodFence(token)
  try {
    await acquireInstallLock(options.conn, lockRoot, options.host, {
      signal: options.signal,
      relayGcClaim: false,
      // Unresolved state ownership cannot become safe through age alone.
      allowStaleTakeover: false,
      waitTimeoutMs: TOPOD_ACTIVATION_FENCE_WAIT_MS,
      owner: { fileName: TOPOD_FENCE_OWNER_FILENAME, token }
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      forgetHeldTopodFence(token)
      return await held()
    }
    throw error
  }
  const fence = activationFence(options, token)
  let retainOnError = false
  let retain = false
  try {
    const result = await runWithTopodFence(fence, () =>
      run({
        retainOnError: () => {
          retainOnError = true
        },
        retain: () => {
          retain = true
        },
        recovered: () => {
          retainOnError = false
        }
      })
    )
    await (retain ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence))
    return result
  } catch (error) {
    // Unconfirmed host work may still mutate state, so do not age its fence.
    if (!isUnconfirmedSshCommandTermination(error)) {
      await (
        retainOnError ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence)
      ).catch((releaseError: unknown) => {
        console.warn(
          `[topod] Failed to release activation lock after an error: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        )
      })
    }
    throw error
  }
}

/** Recover stale, previous-boot or proven exited-own fences; a fresh live owner remains busy. */
export async function withStaleTopodActivationRecoveryLock<T>(
  options: TopodActivationLockOptions,
  run: (control: Pick<TopodActivationLockControl, 'retain'>) => Promise<T>
): Promise<T> {
  const lockRoot = topodActivationTransactionRoot(options.host, options.remoteHome)
  const token = randomUUID()
  rememberHeldTopodFence(token)
  // Takeover replaces the token so the predecessor can neither act nor release.
  await acquireInstallLock(options.conn, lockRoot, options.host, {
    signal: options.signal,
    relayGcClaim: false,
    allowStaleTakeover: true,
    waitTimeoutMs: 0,
    owner: { fileName: TOPOD_FENCE_OWNER_FILENAME, token },
    exitedOwner: exitedOwnLockProof(options, {
      baseDir: topodRemoteBaseDir(options.host, options.remoteHome),
      guardsStateMutation: true
    })
  }).catch((error: unknown) => {
    if (error instanceof RemoteInstallLockBusyError) {
      forgetHeldTopodFence(token)
    }
    throw error
  })
  const fence = activationFence(options, token)
  let retain = false
  let result: T
  try {
    result = await runWithTopodFence(fence, async () => {
      await adoptInterruptedJournal(options)
      return run({ retain: () => (retain = true) })
    })
  } catch (error) {
    // Failed recovery retains ownership fencing until one serving slot is proven.
    if (!isUnconfirmedSshCommandTermination(error)) {
      await orphanRetainedFence(options, fence).catch(() => undefined)
    }
    throw error
  }
  await (retain ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence))
  return result
}

/** Adopt the journal into this generation so release recognizes it as owned. */
async function adoptInterruptedJournal(options: TopodActivationLockOptions): Promise<void> {
  const journal = await readTopodActivationTransaction(options).catch(() => null)
  if (journal) {
    await writeTopodActivationTransaction(options, journal)
  }
}

function activationFence(options: TopodActivationLockOptions, token: string): TopodFence {
  return { lockDir: topodActivationFenceLockDir(options.host, options.remoteHome), token }
}

/** Age retained, finished work for immediate recovery; token guards prevent aging a successor's fence. */
async function orphanRetainedFence(
  options: TopodActivationLockOptions,
  fence: TopodFence
): Promise<void> {
  try {
    await runWithTopodFence(fence, () =>
      execTopodRemote(
        withoutAbortSignal(options),
        orphanInstallLockCommand(options.host, fence.lockDir)
      )
    )
    forgetHeldTopodFence(fence.token)
  } catch (error) {
    // Failed orphan marking keeps the fence held until its normal stale window expires.
    console.warn(
      `[topod] Could not mark a retained activation fence as ownerless: ${String(error)}`
    )
  }
}

/** Failed probes throw; unreadable must never mean unfenced. */
export async function topodActivationFenceExists(
  options: TopodActivationLockOptions
): Promise<boolean> {
  const lockDir = topodActivationFenceLockDir(options.host, options.remoteHome)
  const answer = (
    await execTopodRemote(options, probeInstallLockExistsCommand(options.host, lockDir))
  ).trim()
  if (answer !== 'LOCKED' && answer !== 'OPEN') {
    throw new Error('The activation fence probe returned no verifiable answer.')
  }
  return answer === 'LOCKED'
}

export function releaseTopodActivationFence(
  options: TopodActivationLockOptions,
  token: string
): Promise<void> {
  return releaseActivationFence(options, activationFence(options, token))
}

/** Remove only this generation: journal first, then rename the owned lock aside before deletion. */
async function releaseActivationFence(
  options: TopodActivationLockOptions,
  fence: TopodFence
): Promise<void> {
  const lockRoot = topodActivationTransactionRoot(options.host, options.remoteHome)
  const journal = topodActivationTransactionPath(options.host, options.remoteHome)
  // Cancellation must not prevent releasing a fence already proven unnecessary.
  const target = withoutAbortSignal(options)
  const command = isWindowsRemoteHost(options.host)
    ? topodWindowsHomeOpCommand(options.host, options.remoteHome, 'fence-release', [
        fence.lockDir,
        journal,
        fence.token
      ])
    : posixReleaseFenceCommand(fence, journal, lockRoot)
  const answer = (await execTopodRemote(target, command)).trim()
  forgetHeldTopodFence(fence.token)
  if (answer.endsWith('SUPERSEDED')) {
    console.warn('[topod] A newer run had taken this activation fence over; it was left in place.')
  }
}

/** Rename then check ownership, restoring foreign entries so stalled release cannot delete a successor's state. */
export function posixReleaseFenceCommand(
  fence: TopodFence,
  journal: string,
  lockRoot: string
): string {
  const lock = quotePosixShell(fence.lockDir)
  const journalPath = quotePosixShell(journal)
  const stamp = quotePosixShell(journalFenceStamp(fence.token))
  return [
    `${posixTopodFenceOwnedTest(fence)} || { echo SUPERSEDED; exit 0; };`,
    `ja=${journalPath}.release.$$;`,
    `if mv ${journalPath} "$ja" 2>/dev/null; then`,
    `grep -qF ${stamp} "$ja" || mv -n "$ja" ${journalPath} 2>/dev/null; rm -f "$ja"; fi;`,
    `la=${lock}.released.$$;`,
    `if mv ${lock} "$la" 2>/dev/null; then`,
    `if [ "$(cat "$la"/${TOPOD_FENCE_OWNER_FILENAME} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]; then rm -rf "$la";`,
    `else mv -n "$la" ${lock} 2>/dev/null; fi; fi;`,
    `rmdir ${quotePosixShell(lockRoot)} 2>/dev/null; echo RELEASED`
  ].join(' ')
}

function journalFenceStamp(token: string): string {
  return `"fenceToken": ${JSON.stringify(token)}`
}
