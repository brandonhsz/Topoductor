// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  TOPOD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import {
  topodWindowsNodeCommandLine,
  topodWindowsSlotOpCommand,
  readTopodWindowsEncodedAnswer
} from './topod-remote-windows-node'
import {
  TOPOD_WINDOWS_ENTRY_MARKER,
  TOPOD_WINDOWS_RUNTIME_MARKER
} from '../host-state/topod-windows-host-script'
import {
  TOPOD_LOG_FILENAME,
  TOPOD_READINESS_FILENAME,
  TOPOD_WINDOWS_PROCESS_FILENAME
} from './topod-remote-host-support'
import { topodManagedLaunchEnv, type TopodLaunchSpec } from './topod-remote-launch'
import { TOPOD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../topod/topod-host-unavailable'

export class TopodWindowsLaunchRefusedError extends Error {
  readonly code = TOPOD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start topod outside the SSH session (${reason}). topod needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'TopodWindowsLaunchRefusedError'
  }
}

/** The launcher reported that it could not start topod. */
export class TopodWindowsLaunchFailedError extends Error {
  constructor(detail: string) {
    super(`topod's Windows launcher did not start the candidate: ${detail}.`)
    this.name = 'TopodWindowsLaunchFailedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsTopodLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return topodWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsTopodSlotRuntime(output: string): string {
  const runtime = readTopodWindowsEncodedAnswer(output, TOPOD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this topod slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsTopodSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readTopodWindowsEncodedAnswer(output, TOPOD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'topod.js')
  )
}

export function windowsTopodLaunchCommand(
  host: RemoteHostPlatform,
  spec: TopodLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'topod.js')
): string {
  const dir = spec.remoteInstallDir
  return topodWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, TOPOD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, TOPOD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, TOPOD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `TOPO_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `TOPO_USER_DATA=${spec.userDataDir}`,
    ...topodManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    TOPOD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

export function hasWindowsTopodLaunchReport(output: string): boolean {
  return parseWindowsBreakawayLaunchReport(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, output) !== null
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsTopodLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new TopodWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  if (report?.method === 'failed') {
    throw new TopodWindowsLaunchFailedError(
      `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
    )
  }
  throw new Error("topod's Windows launcher did not start the candidate: no launch report.")
}
