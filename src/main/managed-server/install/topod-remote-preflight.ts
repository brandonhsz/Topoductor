import { randomUUID } from 'node:crypto'
import { TOPOD_NODE_RUNTIME_IDENTITY } from '../../../shared/topod-node-runtime-identity'
import { TOPOD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/topod-artifacts'
import {
  TOPOD_PROFILE_PREFLIGHT_FLAG,
  TOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseTopodProfilePreflight,
  type TopodProfilePreflightResponse
} from '../../../shared/topod-profile-preflight'
import { assertPosixTopodHost } from './topod-remote-host-support'
import {
  topodWindowsNodeCommandLine,
  topodWindowsSlotOpCommand,
  readTopodWindowsEncodedAnswer
} from './topod-remote-windows-node'
import { readWindowsTopodSlotEntry } from './topod-remote-launch-windows'
import { TOPOD_WINDOWS_RUNTIME_MARKER } from '../host-state/topod-windows-host-script'
import { topodNodeSlotRuntimeCommand, selectTopodSlotEntryCommand } from './topod-remote-runtime'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import type { TopodHostTransport } from './topod-host-transport'

export function topodProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string,
  probeDaemonsUnder?: string
): string {
  assertPosixTopodHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, TOPOD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'TOPO_BACKGROUND_LAUNCH=1',
    '"$topod_runtime"',
    '"$topod_entry"',
    TOPOD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce),
    ...(probeDaemonsUnder === undefined ? [] : [quotePosixShell(probeDaemonsUnder)])
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${topodNodeSlotRuntimeCommand(host, directory)}${selectTopodSlotEntryCommand(host, directory)}; ${launch}`
}

/** Qualify the candidate; given the served data root, it also names the daemon generations alive there. */
export async function preflightInstalledTopod(options: {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  probeDaemonsUnder?: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<TopodProfilePreflightResponse> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsTopodProfilePreflightCommand(options, nonce)
    : topodProfilePreflightCommand(
        options.host,
        options.remoteInstallDir,
        nonce,
        options.probeDaemonsUnder
      )
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: TOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  return parseTopodProfilePreflight(output, nonce, TOPOD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

// Windows uses plain argv; topod opens no window and needs no background-launch environment.
async function windowsTopodProfilePreflightCommand(
  options: {
    conn: TopodHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    probeDaemonsUnder?: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execCommand(
    options.conn,
    topodWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readTopodWindowsEncodedAnswer(slotAnswer, TOPOD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this topod slot needs.')
  }
  return topodWindowsNodeCommandLine(runtime, [
    readWindowsTopodSlotEntry(slotAnswer, host, remoteInstallDir),
    TOPOD_PROFILE_PREFLIGHT_FLAG,
    nonce,
    ...(options.probeDaemonsUnder === undefined ? [] : [options.probeDaemonsUnder])
  ])
}
