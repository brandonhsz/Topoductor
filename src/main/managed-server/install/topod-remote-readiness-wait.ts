// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import {
  TOPOD_PID_FILENAME,
  TOPOD_PID_MACHINE_FILENAME,
  TOPOD_READINESS_FILENAME,
  TOPOD_READINESS_MAX_BYTES,
  TOPOD_LAUNCH_MACHINE_COMMAND,
  POSIX_NO_SUCH_PROCESS_CASE
} from './topod-remote-host-support'
import {
  parseTopodReadinessOutput,
  readTopodReadinessCommand,
  type TopodReadinessParse
} from './topod-remote-launch'
import {
  topodWindowsSlotOpCommand,
  readTopodWindowsEncodedAnswer
} from './topod-remote-windows-node'
import { TOPOD_WINDOWS_READINESS_MARKER } from '../host-state/topod-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const TOPOD_READINESS_WAIT_MAX_SECONDS = 20

const TOPOD_LAUNCH_EXITED_MARKER = 'TOPOD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, TOPOD_READINESS_FILENAME))
  const read = `head -c ${TOPOD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, TOPOD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, TOPOD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `topod_launch_here() { topod_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$topod_recorded" ] && [ "$topod_recorded" = "$(${TOPOD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `topod_launch_exited() { topod_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    `probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in ${POSIX_NO_SUCH_PROCESS_CASE}) return 0;; esac; return 1; };`,
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.25 2>/dev/null; then topod_readiness_wait_step=0.25;',
    'else topod_readiness_wait_step=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `topod_readiness_wait_end=$(($(date +%s) + ${waitSeconds}));`,
    'while [ "$(date +%s)" -lt "$topod_readiness_wait_end" ]; do',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${TOPOD_READINESS_MAX_BYTES} ] && break;`,
    `topod_launch_exited && { echo ${TOPOD_LAUNCH_EXITED_MARKER}; break; };`,
    'sleep "$topod_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function topodReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(TOPOD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return topodWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, TOPOD_READINESS_FILENAME),
    String(TOPOD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseTopodReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): TopodReadinessParse {
  return parseTopodReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readTopodWindowsEncodedAnswer(output, TOPOD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function topodLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${TOPOD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${TOPOD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(TOPOD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readTopodReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? topodReadinessWaitCommand(host, remoteInstallDir, 0)
    : readTopodReadinessCommand(host, remoteInstallDir)
}
