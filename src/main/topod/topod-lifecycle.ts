import { setRuntimeBrowserCommandsFactory } from '../runtime/browser/installation/runtime-browser-commands-factory'
import { markHostShuttingDown } from '../startup/quit/host-shutdown-state'
import { setDesktopBrowserBridgeHostEnabled } from '../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { TOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/topod-managed-launch-env'
import { startTopodBrowserProvider } from './topod-browser-startup'
import { TopodRuntimeLifetime, type TopodRuntimeCleanup } from './topod-runtime-lifetime'
import type { TopodManagedStopInstance } from '../../shared/topod-stop-request'
import { acquireTopodInstanceLock } from './topod-instance-lock'
import {
  markTopodRunFailed,
  topodRunFailed,
  recordTopodPreviousUnexpectedExit
} from './topod-unexpected-exit'
import { TOPOD_BUNDLED_LAUNCHER_ENV } from './topod-bundled-runtime'
import { resolveTopodExitCode } from './topod-exit-code'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'
import { recordAgentSessionRuntimeEnd } from '../runtime/agent-session/records/agent-session-runtime-end-record'
import { TOPOD_SHUTDOWN_DEADLINE_MS } from './topod-stop-deadlines'
import { holdTopodTerminalAdmissionUntilExit } from './topod-stop-terminal-admission'
import {
  acquireProfileStateRuntimeAdmission,
  type ProfileStateRuntimeAdmission
} from '../persistence/profile-state/profile-state-access'

const bundledLauncherChannel = process.env[TOPOD_BUNDLED_LAUNCHER_ENV] === '1'
delete process.env[TOPOD_BUNDLED_LAUNCHER_ENV]

function createIdempotentTopodCleanup(cleanup: () => Promise<void>): () => Promise<void> {
  let completion: Promise<void> | null = null
  return () => {
    completion ??= Promise.resolve().then(cleanup)
    return completion
  }
}

/** Return whether this caller owns the stop; fatal faults supply a nonzero completed-stop code. */
export type TopodShutdownTrigger = (
  reason: string,
  onFailed?: () => void,
  stoppedExitCode?: number
) => boolean

let installedShutdown: TopodShutdownTrigger | null = null

/** Deduplicate launcher/child signals into one bounded stop; onFailed retracts clean-stop records. */
export function installTopodShutdownSignals(
  stop: () => Promise<void>,
  deadlineMs = TOPOD_SHUTDOWN_DEADLINE_MS
): TopodShutdownTrigger {
  let stopping = false
  let exitCode = 0
  let failed = false
  let retractClean: (() => void) | undefined
  const markFailed = (): void => {
    if (!failed) {
      failed = true
      retractClean?.()
    }
  }
  const shutdown: TopodShutdownTrigger = (signal, onFailed, stoppedExitCode = 0) => {
    // Yielding a lost lock is not a crash; the successor owns the lock now.
    if (stoppedExitCode !== 0 && stoppedExitCode !== SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE) {
      markTopodRunFailed()
    }
    if (stopping) {
      // Fatal faults must escalate an in-progress clean stop to failure.
      if (stoppedExitCode !== 0 && exitCode === 0) {
        exitCode = stoppedExitCode
        onFailed?.()
        markFailed()
      }
      return false
    }
    stopping = true
    markHostShuttingDown()
    holdTopodTerminalAdmissionUntilExit()
    exitCode = stoppedExitCode
    retractClean = onFailed
    setTimeout(() => {
      console.error(`topod: shutdown after ${signal} exceeded ${deadlineMs}ms — exiting`)
      markFailed()
      process.exit(1)
    }, deadlineMs)
    stop()
      .then(() => process.exit(exitCode))
      .catch((error) => {
        console.error(`topod: shutdown after ${signal} failed:`, error)
        markFailed()
        process.exit(resolveTopodExitCode(error))
      })
    return true
  }
  installedShutdown = shutdown
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // Survive terminal hangups; INT/TERM request graceful shutdown.
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {})
  }
  if (bundledLauncherChannel && typeof process.send === 'function') {
    process.once('disconnect', () => shutdown('launcher disconnect'))
    if (!process.connected) {
      shutdown('launcher disconnect')
    }
  }
  return shutdown
}

export async function stopTopodStructuredAgentSessions(): Promise<void> {
  const { stopStructuredAgentSessionRuntime } =
    await import('../runtime/agent-session/structured-agent-session-runtime')
  await stopStructuredAgentSessionRuntime({ trigger: 'quit' })
}

export async function startTopodWithLifecycle<T extends object>(
  start: (registerRuntimeCleanup: (cleanup: TopodRuntimeCleanup) => void) => Promise<T>,
  cleanupHost: (runtimeCleanupSucceeded: boolean) => Promise<void>
): Promise<T & { stop(): Promise<void> }> {
  const runtime = new TopodRuntimeLifetime()
  const cleanup = createIdempotentTopodCleanup(async () => {
    // Stamp quit before awaiting teardown so dying chat agents read as restart rather than crash.
    recordAgentSessionRuntimeEnd('quit')
    // Startup failures reach cleanup without shutdown admission while RPC may already be serving.
    markHostShuttingDown()
    let runtimeCleanupSucceeded = false
    try {
      await runtime.stop()
      runtimeCleanupSucceeded = true
    } finally {
      await cleanupHost(runtimeCleanupSucceeded)
    }
  })
  try {
    const handle = await start((nextCleanup) => runtime.add(nextCleanup))
    return { ...handle, stop: cleanup }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      // Preserve the startup fault while recording cleanup failures.
      console.error('[topod] startup cleanup failed:', cleanupError)
    }
    throw error
  }
}

/** Keep profile admission/lock until all runtime writers stop. */
export async function startTopodWithHost<T extends object>(
  userDataPath: string,
  start: (registerCleanup: (cleanup: TopodRuntimeCleanup) => void) => Promise<T>,
  runQuitHandlers: () => void | Promise<void>
): Promise<T & { stop(): Promise<void>; instance: TopodManagedStopInstance }> {
  const instanceLock = acquireTopodInstanceLock(userDataPath, {
    // Yield the data root to the process that took its lock; supervisors stand by on this code.
    onExclusivityLost: () => {
      console.error('[topod] Stopping so only one runtime writes this data root.')
      installedShutdown?.(
        'instance lock lost',
        undefined,
        SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
      )
    }
  })
  const previous = instanceLock.previousUnexpectedExit
  recordTopodPreviousUnexpectedExit(previous)
  if (previous) {
    console.error(
      `[topod] the previous run (pid ${previous.pid}, ${previous.version}) exited without stopping cleanly`
    )
  }
  const { pid, startedAtMs, nonce } = instanceLock.record
  const instance = { pid, startedAtMs, nonce, lockPath: instanceLock.path }
  let admission: ProfileStateRuntimeAdmission | undefined
  let browserProvider: ReturnType<typeof startTopodBrowserProvider> | undefined
  return startTopodWithLifecycle(
    async (registerCleanup) => {
      admission = acquireProfileStateRuntimeAdmission(userDataPath)
      // Browser authorization UI must not block RPC readiness.
      browserProvider = startTopodBrowserProvider({ userDataPath })
      // Only managed hosts have opted-in desktop bridges; user-started hosts route to paired page hosts.
      setDesktopBrowserBridgeHostEnabled(Boolean(process.env[TOPOD_MANAGED_ACTIVATION_ROOT_ENV]))
      return { ...(await start(registerCleanup)), instance }
    },
    async (runtimeCleanupSucceeded) => {
      // Failed cleanup retains both ownership fences until process exit.
      const host = new TopodRuntimeLifetime(() => {
        if (runtimeCleanupSucceeded && !topodRunFailed()) {
          instanceLock.release()
        }
      })
      host.add(({ failed }) => {
        if (runtimeCleanupSucceeded && !failed) {
          admission?.release()
        }
      })
      host.add(() => runQuitHandlers())
      host.add(() => setRuntimeBrowserCommandsFactory(null))
      host.add(() => setDesktopBrowserBridgeHostEnabled(false))
      host.add(() => browserProvider?.stop())
      await host.stop()
    }
  )
}

export async function flushTopodProfileStoreForShutdown(
  store: { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> },
  paneGrids?: { flushPaneGrids(): Promise<void> | null } | null
): Promise<void> {
  // A pane's grid still inside its write burst joins the final save.
  const flushing = paneGrids?.flushPaneGrids()
  if (flushing) {
    await flushing
  }
  try {
    await store.flushFinalOrThrowAsync()
  } finally {
    await store.freezeWritesAsync()
  }
}
