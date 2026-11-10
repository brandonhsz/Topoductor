/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (#25934; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives topod restarts. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { TOPOD_PID_FILENAME } from './topod-remote-host-support'

export const TOPOD_LAUNCH_SSH_SESSION_FILENAME = '.topod-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsTopodLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function topodSshSessionAncestorShellFunction(): string {
  return (
    'topod_ssh_session() { topod_sp=$1; topod_si=0; ' +
    `while [ "$topod_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$topod_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'topod_sc=$(ps -o comm= -p "$topod_sp" 2>/dev/null) || return 1; ' +
    'case "${topod_sc##*/}" in sshd*) ' +
    'topod_ss=$(ps -o lstart= -p "$topod_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$topod_sp" $topod_ss; return 0;; esac; ' +
    'topod_sp=$(ps -o ppid= -p "$topod_sp" 2>/dev/null | tr -d " "); ' +
    'topod_si=$((topod_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureTopodLaunchSshSessionCommand(): string {
  return (
    `${topodSshSessionAncestorShellFunction()} ` +
    'topod_session=$(topod_ssh_session "$$" 2>/dev/null) || topod_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, TOPOD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `topod_daemon_live() { topod_ddir=${daemonDir}; for topod_df in "$topod_ddir"/daemon-v*.pid; do ` +
    '[ -f "$topod_df" ] || continue; ' +
    'topod_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$topod_df" | head -n 1); ' +
    '[ -n "$topod_dp" ] || continue; ' +
    'kill -0 "$topod_dp" 2>/dev/null || continue; ' +
    'topod_da=$(ps -o args= -p "$topod_dp" 2>/dev/null); [ -n "$topod_da" ] || return 2; ' +
    'case "$topod_da" in *daemon-entry*"$topod_ddir"* | *"$topod_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeTopodLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before topod creates its data root.
    `{ topod_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'topod_daemon_live; topod_dl=$?; ' +
    'if [ "$topod_dl" = 0 ]; then ' +
    `topod_prev=$(cat ${file}); rm -f ${file}; set -- $topod_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$topod_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$topod_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$topod_session" ] || ` +
    `( umask 077; echo "$topod_bg" $topod_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function topodLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, TOPOD_PID_FILENAME))
  return [
    'topod_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'topod_major=${topod_mac%%.*};',
    'case "$topod_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$topod_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `topod_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `topod_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $topod_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$topod_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'topod_sshd=$2; shift 2; topod_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'topod_now=$(ps -o lstart= -p "$topod_sshd" 2>/dev/null); topod_now=$(echo $topod_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$topod_now" ] || [ "$topod_now" != "$topod_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type TopodLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseTopodLaunchSshSession(output: string): TopodLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
