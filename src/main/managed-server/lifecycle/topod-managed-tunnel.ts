import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { SshTarget } from '../../../shared/ssh-types'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { probeManagedTopodTunnel } from './topod-managed-tunnel-resume'
import {
  ensureManagedTopodServing,
  forgetManagedTopodServingVerdict
} from './topod-managed-serving'
import { getManagedTopodCrashLoopBrake } from './topod-managed-crash-loop'
import { TopodManagedTunnelManager } from './topod-managed-tunnel-manager'
import { buildOnBindableLocalPort } from './topod-managed-tunnel-local-port'
import { getRemoteRuntimeSharedControlAnsweredAt } from '../../ipc/runtime-environments/runtime-environment-shared-control-answers'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'
import {
  MANAGED_TOPOD_TUNNEL_TARGETING,
  type TopodTunnelStartChecks
} from './topod-managed-tunnel-target'
import {
  liveManagedTopodPairingRepairDeps,
  ManagedTopodPairingRepairs,
  pairingRevisionOf
} from './topod-managed-pairing-repair'
import {
  buildWithPairingRepair,
  type ManagedTopodPairingRecovery
} from './topod-managed-tunnel-pairing-recovery'

const managedTunnels = new TopodManagedTunnelManager({
  getConnectionManager: getSshConnectionManager,
  getTargetStore: getSshTargetRegistryStore,
  targeting: MANAGED_TOPOD_TUNNEL_TARGETING,
  ensureServing: (input) =>
    ensureManagedTopodServing({
      ...input,
      probe: probeManagedTopodTunnel,
      answeredAt: getRemoteRuntimeSharedControlAnsweredAt
    })
})

const pairingRepairs = new Map<string, ManagedTopodPairingRepairs>()

function pairingRecovery(userDataPath: string): ManagedTopodPairingRecovery {
  let repairs = pairingRepairs.get(userDataPath)
  if (!repairs) {
    repairs = new ManagedTopodPairingRepairs(liveManagedTopodPairingRepairDeps(userDataPath))
    pairingRepairs.set(userDataPath, repairs)
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    repairs,
    ensure: (environment) =>
      managedTunnels.ensure(environment, () =>
        resolveEnvironmentOrNull(userDataPath, environment.id)
      )
  }
}

/** Return stored credentials: tunnel repair may have replaced the pairing. */
export async function ensureTopodManagedTunnel(
  userDataPath: string,
  selector: string
): Promise<KnownRuntimeEnvironment> {
  const { id } = resolveEnvironment(userDataPath, selector)
  await buildOnBindableLocalPort(userDataPath, id, () =>
    buildWithPairingRepair(pairingRecovery(userDataPath), id, (environment) =>
      managedTunnels.ensure(environment, () => resolveEnvironmentOrNull(userDataPath, id))
    )
  )
  return resolveEnvironment(userDataPath, id)
}

export async function rebuildTopodManagedTunnel(
  userDataPath: string,
  selector: string
): Promise<'built' | 'repaired'> {
  const { id } = resolveEnvironment(userDataPath, selector)
  return buildOnBindableLocalPort(userDataPath, id, () =>
    buildWithPairingRepair(pairingRecovery(userDataPath), id, (environment) =>
      managedTunnels.rebuild(environment, () => resolveEnvironmentOrNull(userDataPath, id))
    )
  )
}

/** Reprove pinned-server refusal before repair; foreign servers must fail identity validation. */
export function recoverRefusedManagedTopodPairing(
  userDataPath: string,
  environmentId: string
): Promise<'built' | 'repaired'> {
  return rebuildTopodManagedTunnel(userDataPath, environmentId)
}

/** Ignore failures belonging to older pairing revisions. */
export function managedTopodPairingFailureStands(
  userDataPath: string,
  environmentId: string
): boolean {
  const environment = resolveEnvironmentOrNull(userDataPath, environmentId)
  return (
    environment !== null &&
    (pairingRepairs
      .get(userDataPath)
      ?.standingFailure(environmentId, pairingRevisionOf(environment)) ?? null) !== null
  )
}

/** Explicit connect clears recent repair failures and re-arms automatic starts. */
export function forgetManagedTopodAutomaticFailures(
  userDataPath: string,
  environmentId: string
): void {
  pairingRepairs.get(userDataPath)?.forgetFailures(environmentId)
  getManagedTopodCrashLoopBrake().forget(environmentId)
  forgetManagedTopodServingVerdict(environmentId)
}

function resolveEnvironmentOrNull(userDataPath: string, id: string) {
  try {
    return resolveEnvironment(userDataPath, id)
  } catch {
    return null
  }
}

export function verifyManagedTunnelServing(environment: KnownRuntimeEnvironment) {
  return managedTunnels.verifyServing(environment)
}

export function disposeTopodManagedTunnels(): void {
  managedTunnels.dispose()
}

// System SSH forwards have independent processes and can outlive Topo.
export function shutdownTopodManagedTunnels(): Promise<void> {
  return managedTunnels.shutdown()
}

export function recoverTopodManagedTunnelsAfterHostResume(
  userDataPath: string,
  options: { attempts: number; timeoutMs: number }
): Promise<void> {
  return managedTunnels.recoverAfterHostResume({
    ...options,
    resolveEnvironment: (environmentId) => resolveEnvironmentOrNull(userDataPath, environmentId)
  })
}

export function startTopodManagedTunnel(
  environmentId: string,
  target: SshTarget,
  connection: SshConnection,
  remotePort: number,
  checks?: TopodTunnelStartChecks
): Promise<number> {
  return managedTunnels.start(environmentId, target, connection, remotePort, checks)
}

export function closeTopodManagedTunnel(environmentId: string): Promise<void> {
  return managedTunnels.close(environmentId)
}

export function closeTopodManagedTunnelsForTarget(targetId: string): Promise<void> {
  return managedTunnels.closeTarget(targetId)
}
