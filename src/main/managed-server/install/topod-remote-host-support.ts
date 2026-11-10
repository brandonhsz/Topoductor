// Windows operations use the host script; only POSIX command builders use this guard.
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'

export class TopodRemoteLaunchUnsupportedError extends Error {
  readonly code = 'topod_remote_launch_unsupported_host'
  constructor(hostLabel: string) {
    super(
      `This topod command does not run on a ${hostLabel} host. The install transaction is ` +
        'host-agnostic, but this step is a POSIX command with a separate Windows path.'
    )
    this.name = 'TopodRemoteLaunchUnsupportedError'
  }
}

export function assertPosixTopodHost(host: RemoteHostPlatform): void {
  if (isWindowsRemoteHost(host)) {
    throw new TopodRemoteLaunchUnsupportedError('Windows')
  }
}

/** Candidate stdout containing readiness; bounded below even if other output follows. */
export const TOPOD_READINESS_FILENAME = '.topod-readiness'
export const TOPOD_LOG_FILENAME = 'topod.log'
// Candidate stdout is untrusted in size; never read runaway output whole.
export const TOPOD_READINESS_MAX_BYTES = 256 * 1024

export const TOPOD_PID_FILENAME = '.topod-pid'
/** Pair the PID with boot ID and node name; shared home paths cannot identify a machine. */
export const TOPOD_PID_MACHINE_FILENAME = `${TOPOD_PID_FILENAME}-machine`
/** Emit nothing without a boot ID; launch and later wait compare this identity. */
export const TOPOD_LAUNCH_MACHINE_COMMAND = 'cat /proc/sys/kernel/random/boot_id&&uname -n'

/** Windows pairs PID with creation time because PID reuse alone cannot identify the process. */
export const TOPOD_WINDOWS_PROCESS_FILENAME = '.topod-process.json'

/** ESRCH text: bash, dash and BusyBox print "No such process"; zsh and ksh print it lowercase (#34149). */
export const POSIX_NO_SUCH_PROCESS_CASE = '*[Nn]"o such process"*'

/** kill -0 includes zombies; ps excludes them, while missing evidence conservatively retains the process. */
export function posixProcessAliveShellFunction(
  options: { refuseUnverifiable?: boolean } = {}
): string {
  // Destructive lifecycle steps need explicit absence; permission failures cannot prove exit.
  const probe = options.refuseUnverifiable
    ? 'probe_error=$(LC_ALL=C kill -0 "$1" 2>&1) || { ' +
      `case "$probe_error" in ${POSIX_NO_SUCH_PROCESS_CASE}) return 1;; ` +
      '*) echo UNKNOWN; exit 0;; esac; }; '
    : 'kill -0 "$1" 2>/dev/null || return 1; '
  return (
    `topod_alive() { ${probe}` +
    'topod_stat=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$topod_stat" ] || ' +
    // Field 3 of /proc/<pid>/stat follows the last ")": comm itself may hold spaces or parens.
    'topod_stat=$(cat "/proc/$1/stat" 2>/dev/null) && topod_stat=${topod_stat##*") "}; ' +
    'case "$topod_stat" in Z*) return 1;; esac; return 0; };'
  )
}

/** Prints a PID's argv; slim Linux images ship no ps, so fall back to /proc (#34149). */
export function posixProcessArgsShellFunction(): string {
  return (
    'topod_args() { topod_argv=$(ps -o args= -p "$1" 2>/dev/null) && [ -n "$topod_argv" ] || ' +
    '{ topod_argv=$(tr "\\000" " " 2>/dev/null < "/proc/$1/cmdline") || return 1; ' +
    // Kernel threads and zombies have no argv; their stat line still names them.
    '[ -n "$topod_argv" ] || topod_argv=$(cat "/proc/$1/stat" 2>/dev/null) || return 1; }; ' +
    'printf "%s\\n" "$topod_argv"; };'
  )
}
