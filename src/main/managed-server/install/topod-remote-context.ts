import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { SshTarget } from '../../../shared/ssh-types'
import type { TopodActivationRecord } from '../activation/topod-activation-record'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import { resolveTopodRuntimeTarget } from '../lifecycle/topod-runtime-target'
import { LINUX_LIBC_FIRST_PROBE } from '../../node-runtime/linux-libc-probe'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { prepareWindowsTopodHost } from '../host-state/topod-windows-host-preparation'
import {
  isWslTopodHostTarget,
  type TopodHostTarget,
  type TopodHostTransport
} from './topod-host-transport'
import {
  decideTopodMachineHome,
  topodMachineDataRoot,
  topodMachineHomeDir,
  topodMachineHomeProbeCommand,
  topodMachineOwnershipUnresolvedMessage,
  parseTopodMachineHomeProbe
} from '../host-state/topod-machine-home'
import {
  topodMachineClaimCommand,
  readTopodMachineClaimAnswer
} from '../host-state/topod-machine-claim-command'
import { execTopodRemote, type TopodRemoteExecTarget } from './topod-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/remote-exec/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import { TopodHostUnsupportedError } from '../../topod/topod-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/remote-host/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type TopodRemoteContext<Target extends TopodHostTarget = SshTarget> = {
  activationRecord: TopodActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: TopodHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveTopodRemoteContext<Target extends TopodHostTarget = SshTarget>(
  target: Target,
  connection: TopodHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform,
  /**
   * Facts the caller already read on this host. `loginHome` serves only login-home placement;
   * `firstLibcProbeOutput` answers the libc probe's first command, whose fallbacks still run.
   */
  known: {
    loginHome?: string
    firstLibcProbeOutput?: string
    /** Replaces the plain activation record read; WSL reads its connect snapshot here. */
    readActivationRecord?: (
      target: TopodRemoteExecTarget & { remoteHome: string; userDataDir: string }
    ) => Promise<TopodActivationRecord>
  } = {}
): Promise<TopodRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new TopodHostUnsupportedError(
      isWslTopodHostTarget(target)
        ? 'Topo’s server doesn’t support this WSL distro’s platform. Use an x64 or arm64 Linux distro.'
        : 'Topo’s server doesn’t support this SSH host’s platform.'
    )
  }
  const remote = { conn: connection, host, signal }
  const { topodHome: remoteHome, userDataDir } = await resolveTopodMachineHome(
    remote,
    !isWslTopodHostTarget(target),
    known.loginHome
  )
  let firstLibcProbeOutput = known.firstLibcProbeOutput
  const serverTarget = await resolveTopodRuntimeTarget({
    conn: connection,
    host,
    signal,
    ...(firstLibcProbeOutput === undefined
      ? {}
      : {
          exec: async (command: string) => {
            if (command === LINUX_LIBC_FIRST_PROBE && firstLibcProbeOutput !== undefined) {
              const output = firstLibcProbeOutput
              firstLibcProbeOutput = undefined
              return output
            }
            // The fallbacks run exactly as the default exec would.
            return execCommand(connection, command, { signal })
          }
        })
  })
  if (!isWslTopodHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsTopodHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await (known.readActivationRecord ?? readTopodActivationRecord)({
    ...remote,
    remoteHome,
    userDataDir
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveTopodMachineHome(
  remote: TopodRemoteExecTarget,
  keyByMachine: boolean,
  knownLoginHome?: string
): Promise<{ loginHome: string; topodHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      knownLoginHome ?? (await execTopodRemote(remote, readRemoteHomeCommand(host))),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      topodHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.topo')
    }
  }
  const probe = parseTopodMachineHomeProbe(
    await execTopodRemote(remote, topodMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideTopodMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      topodMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readTopodMachineClaimAnswer(
      await execTopodRemote(remote, topodMachineClaimCommand(host, loginHome, decision.machineKey))
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      topodHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.topo')
    }
  }
  const topodHome = topodMachineHomeDir(host, loginHome, decision.machineKey)
  await execTopodRemote(remote, `umask 077; mkdir -p ${quotePosixShell(topodHome)}`)
  return {
    loginHome,
    topodHome,
    userDataDir: topodMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
