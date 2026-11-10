// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../observability/redactor'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { TOPOD_LOG_FILENAME } from './topod-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import {
  topodWindowsSlotOpCommand,
  readTopodWindowsEncodedAnswer
} from './topod-remote-windows-node'
import { TOPOD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/topod-windows-host-script'
import type { TopodRemoteExecTarget } from './topod-remote-runtime-control'

export const TOPOD_LOG_TAIL_LINES = 40
export const TOPOD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const TOPOD_LOG_TAIL_TIMEOUT_MS = 10_000

export function topodLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, TOPOD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return topodWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(TOPOD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${TOPOD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseTopodLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readTopodWindowsEncodedAnswer(output, TOPOD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-TOPOD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-TOPOD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readTopodLogTail(
  target: TopodRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, topodLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: TOPOD_LOG_TAIL_TIMEOUT_MS
    })
    return parseTopodLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the topod.log tail:', error)
    return null
  }
}

export async function withTopodLogTail(
  target: TopodRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readTopodLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of topod.log:\n${tail}` : message
}
