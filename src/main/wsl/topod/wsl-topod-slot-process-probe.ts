/** Whether any process runs from an topod slot: its server, or a terminal daemon a candidate spawned there, which outlives the candidate's stop. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { posixProcessArgsShellFunction } from '../../managed-server/install/topod-remote-host-support'
import { isTopodInstallDirLive } from '../../managed-server/install/topod-remote-gc'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'

// Every shell running this probe carries it in argv, so the probe never counts itself.
const PROBE_MARKER = '__TOPO_SLOT_PROCESS_PROBE__'

/** Prints LIVE, DEAD or UNKNOWN; anything unreadable is UNKNOWN. */
export function wslTopodSlotProcessProbeCommand(
  host: RemoteHostPlatform,
  slotDir: string,
  userDataDir: string
): string {
  const slot = quotePosixShell(`${slotDir.replace(/\/+$/u, '')}/`)
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  const inSlot =
    'grep -F -e "$topod_slot" -e "$topod_real/" | ' + `grep -vF -- ${PROBE_MARKER} | grep -q .`
  return [
    `topod_slot=${slot}; topod_ddir=${daemonDir}; : ${PROBE_MARKER};`,
    // Node realpaths its entry, so a daemon behind a symlinked home names the resolved slot.
    'topod_real=$(cd "$topod_slot" 2>/dev/null && pwd -P) && [ -n "$topod_real" ] || { echo UNKNOWN; exit 0; };',
    posixProcessArgsShellFunction(),
    // A live daemon whose pid file names it must be identified, not skipped.
    'for topod_df in "$topod_ddir"/daemon-v*.pid; do [ -f "$topod_df" ] || continue;',
    'topod_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$topod_df" | head -n 1);',
    '[ -n "$topod_dp" ] || continue; kill -0 "$topod_dp" 2>/dev/null || continue;',
    'topod_da=$(topod_args "$topod_dp") || { echo UNKNOWN; exit 0; };',
    `printf '%s\\n' "$topod_da" | ${inSlot} && { echo LIVE; exit 0; };`,
    'done;',
    // Capture first so the filters below never list themselves.
    'if topod_all=$(ps -ww -eo args= 2>/dev/null) && [ -n "$topod_all" ]; then :;',
    'elif [ -r /proc/self/cmdline ]; then',
    'topod_all=$(for topod_p in /proc/[0-9]*; do tr "\\000" " " < "$topod_p/cmdline" 2>/dev/null; echo; done);',
    'else echo UNKNOWN; exit 0; fi;',
    `if printf '%s\\n' "$topod_all" | ${inSlot}; then echo LIVE; else echo DEAD; fi`
  ].join(' ')
}

/** True unless both the server's pid file and a process scan prove nothing runs from the slot. */
export async function isWslTopodSlotInUse(
  slot: TopodSlotOptions,
  slotDir: string
): Promise<boolean> {
  if (await isTopodInstallDirLive(slot, slotDir)) {
    return true
  }
  try {
    const answer = await execCommand(
      slot.conn,
      wslTopodSlotProcessProbeCommand(slot.host, slotDir, slot.userDataDir),
      { wrapCommand: true, signal: slot.signal }
    )
    return answer.trim().split('\n').at(-1)?.trim() !== 'DEAD'
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return true
  }
}
