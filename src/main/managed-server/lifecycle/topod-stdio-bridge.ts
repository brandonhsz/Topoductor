import {
  TopodHostUnsupportedError,
  TopodStdioBridgeUnavailableError
} from '../../topod/topod-host-unavailable'
import { resolveTopodRemoteContext } from '../install/topod-remote-context'
import { topodWindowsHomeOpCommand } from '../install/topod-remote-windows-node'
import {
  topodBashStdioBridgeCommand,
  topodPosixStdioBridgeCommand,
  type TopodStdioBridgeMode
} from './topod-stdio-bridge-script'
import { TopodStdioBridgeDecoder, type TopodStdioBridgeSignal } from './topod-stdio-bridge-stream'
import { isWslTopodHostTarget, type TopodHostTransport } from '../install/topod-host-transport'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'

export type TopodStdioBridge = {
  command: string
  mode: TopodStdioBridgeMode
  wrapCommand: boolean
}

const TOPOD_STDIO_BRIDGE_CHECK_TIMEOUT_MS = 20_000
const MAX_STDERR_TAIL_CHARS = 2_000
// POSIX shells and cmd.exe report a command they cannot find with these.
const COMMAND_NOT_FOUND_EXITS: ReadonlySet<number | null> = new Set([127, 9009])

export async function resolveTopodStdioBridge(
  conn: TopodHostTransport,
  port: number
): Promise<TopodStdioBridge> {
  // WSL deploy already proved a POSIX Linux host; avoid redundant probing.
  if (isWslTopodHostTarget(conn.getTarget())) {
    return { command: topodBashStdioBridgeCommand(port), mode: 'raw', wrapCommand: true }
  }
  const host = await detectRemoteHostPlatform(conn)
  if (!host) {
    throw new TopodHostUnsupportedError('Topo’s server doesn’t support this SSH host’s platform.')
  }
  if (!isWindowsRemoteHost(host)) {
    return { command: topodPosixStdioBridgeCommand(port), mode: 'raw', wrapCommand: true }
  }
  const target = conn.getTarget()
  // Stage this client's pinned node.exe/script because app updates may change them.
  const context = await resolveTopodRemoteContext(target, conn, undefined, host)
  return {
    command: topodWindowsHomeOpCommand(host, context.remoteHome, 'stdio-bridge', [String(port)]),
    mode: 'base64',
    wrapCommand: host.commandDialect !== 'powershell'
  }
}

export function openTopodStdioBridgeChannel(
  conn: TopodHostTransport,
  bridge: TopodStdioBridge
): Promise<RemoteCommandChannel> {
  return conn.exec(bridge.command, { wrapCommand: bridge.wrapCommand })
}

function closeQuietly(channel: RemoteCommandChannel): void {
  try {
    channel.close()
  } catch {}
}

/** Any sentinel proves the bridge executable, even if topod refuses connection. Only reported command-not-found proves permanent unsupported status; other failures stay unverifiable. */
export async function checkTopodStdioBridge(
  conn: TopodHostTransport,
  bridge: TopodStdioBridge,
  timeoutMs = TOPOD_STDIO_BRIDGE_CHECK_TIMEOUT_MS
): Promise<'running' | 'unverifiable'> {
  let channel: RemoteCommandChannel
  try {
    channel = await openTopodStdioBridgeChannel(conn, bridge)
  } catch {
    return 'unverifiable'
  }
  const decoder = new TopodStdioBridgeDecoder(bridge.mode)
  let stderr = ''
  let exitCode: number | null = null
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => settle('unverifiable'), timeoutMs)
    function settle(verdict: 'running' | 'unverifiable' | Error): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      closeQuietly(channel)
      decoder.destroy()
      if (verdict instanceof Error) {
        reject(verdict)
      } else {
        resolve(verdict)
      }
    }
    const unavailable = (detail: string): Error =>
      new TopodStdioBridgeUnavailableError(
        `The SSH host could not run the stdio bridge for this host’s Topo server: ${detail}`
      )
    decoder.on('signal', (signal: TopodStdioBridgeSignal) => {
      settle(signal === 'no-node' ? unavailable('no pinned Node runtime') : 'running')
    })
    decoder.on('error', () => settle('unverifiable'))
    decoder.resume()
    channel.pipe(decoder)
    channel.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_TAIL_CHARS)
    })
    channel.on('exit', (code: unknown) => {
      exitCode = typeof code === 'number' ? code : null
    })
    channel.on('close', () => {
      // Only command-not-found is permanent; lost channels or interrupted script/runtime execution prove nothing.
      settle(
        COMMAND_NOT_FOUND_EXITS.has(exitCode)
          ? unavailable(`exit ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
          : 'unverifiable'
      )
    })
    channel.on('error', () => settle('unverifiable'))
  })
}
