import { TOPOD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/topod-profile-preflight'
import {
  topodLaunchCommand,
  parseTopodReadinessOutput,
  type TopodLaunchSpec,
  type TopodReadinessParse
} from './topod-remote-launch'
import {
  hasWindowsTopodLaunchReport,
  readWindowsTopodLaunchReport,
  readWindowsTopodSlotRuntime,
  readWindowsTopodSlotEntry,
  windowsTopodLaunchCommand,
  windowsTopodLaunchRuntimeCommand
} from './topod-remote-launch-windows'
import {
  TOPOD_READINESS_WAIT_MAX_SECONDS,
  topodLaunchExitedDuringWait,
  topodReadinessWaitCommand,
  parseTopodReadinessWaitOutput
} from './topod-remote-readiness-wait'
import type { TopodHostTransport } from './topod-host-transport'
import { errorMessage } from '../../../shared/error-message'
import {
  execCommand,
  isSshCommandExitError,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentTopodFence,
  isTopodFenceLost,
  TopodFenceLostError,
  posixTopodFenceGuard
} from '../activation/topod-activation-fence-scope'
import { topodWindowsHomeOpCommand } from './topod-remote-windows-node'
import { TOPOD_WINDOWS_FENCE_ARG } from '../host-state/topod-windows-host-fence-ops'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type TopodRemoteExecTarget = {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execTopodRemote(
  target: TopodRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentTopodFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixTopodFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(TOPOD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(topodWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isTopodFenceLost(error) ? new TopodFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execTopodRemoteOr(
  target: TopodRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execTopodRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof TopodFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchTopodAndAwaitReadiness(
  target: TopodRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: TopodLaunchSpec
): Promise<TopodReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execTopodRemote(
      target,
      windowsTopodLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsTopodSlotRuntime(slotAnswer)
    const slotEntry = readWindowsTopodSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsTopodLaunchReport(
      await windowsLaunchReportOutput(
        target,
        windowsTopodLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execTopodRemote(
      target,
      topodLaunchCommand(
        target.host,
        spec,
        target.conn.topodLaunchDetach ?? 'nohup',
        (await target.conn.topodLaunchEnv?.({ fullVersion: spec.fullVersion })) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? TOPOD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseTopodReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      TOPOD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execTopodRemote(
        target,
        topodReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof TopodFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[topod] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseTopodReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || topodLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}

/** The launcher writes its report before exiting nonzero, so a failed launch still names its cause. */
async function windowsLaunchReportOutput(
  target: TopodRemoteExecTarget,
  command: string
): Promise<string> {
  try {
    return await execTopodRemote(target, command)
  } catch (error) {
    // Without a report the command error carries the better diagnostic.
    if (isSshCommandExitError(error) && hasWindowsTopodLaunchReport(error.stdout)) {
      return error.stdout
    }
    throw error
  }
}
