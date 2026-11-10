// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedTopodInstallDir } from './topod-managed-runtime-context'
import { resolveTopodRemoteContext } from '../install/topod-remote-context'
import {
  parseTopodReadinessWaitOutput,
  readTopodReadinessNowCommand
} from '../install/topod-remote-readiness-wait'
import {
  execTopodRemote,
  type TopodRemoteExecTarget
} from '../install/topod-remote-runtime-control'
import type { TopodHostTarget, TopodHostTransport } from '../install/topod-host-transport'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'

export type TopodTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: TopodHostTransport
}

export function topodBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedTopodSlotReadiness(
  target: TopodRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseTopodReadinessWaitOutput(
    target.host,
    await execTopodRemote(
      target,
      readTopodReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedTopodReadiness(input: {
  target: TopodHostTarget
  connection: TopodHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveTopodRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedTopodSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedTopodInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: TopodTunnelPortInput): Promise<number | null> {
  if (!input.environment.topodDeployment) {
    return null
  }
  const readiness = await readActiveManagedTopodReadiness(input)
  return readiness ? topodBoundPort(readiness) : null
}

export async function resolveManagedTopodTunnelPort(input: TopodTunnelPortInput): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed topod environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed Topo server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedTopodPublishedPort(
  input: TopodTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}

/** The server key the active slot offers to new pairings; null when unpublished or unreadable. */
export async function readManagedTopodPublishedKey(
  input: TopodTunnelPortInput
): Promise<string | null> {
  if (!input.environment.topodDeployment) {
    return null
  }
  try {
    const readiness = await readActiveManagedTopodReadiness(input)
    return readiness?.pairing.available
      ? (parsePairingCode(readiness.pairing.url)?.publicKeyB64 ?? null)
      : null
  } catch {
    return null
  }
}
