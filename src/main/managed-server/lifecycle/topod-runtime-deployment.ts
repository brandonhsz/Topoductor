// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/remote-runtime/host-catalog/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { addManagedTopodEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import {
  getTopodSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  TOPOD_MANAGED_REMOTE_PORT,
  type TopodManagedDeferral,
  type TopodManagedDeployResult
} from '../../../shared/topod-managed-runtime'
import { getManagedTopodFenceEnvironmentId } from '../../../shared/managed-topod-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeTopodArtifact } from '../../topod/topod-artifact-materializer'
import {
  closeTopodManagedTunnel,
  ensureTopodManagedTunnel,
  startTopodManagedTunnel
} from './topod-managed-tunnel'
import { recoverInterruptedTopodActivation } from '../activation/topod-activation-recovery'
import { wakeAlreadyActiveTopod } from './topod-already-active-wake'
import { readTopodActivationRecord } from '../activation/topod-activation-record-store'
import { resolveTopodRemoteContext, type TopodRemoteContext } from '../install/topod-remote-context'
import { deployTopod } from '../install/topod-remote-deploy'
import {
  adoptRunningTopodVersion,
  type TopodRunningAdoption
} from '../activation/topod-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'

import { TOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../activation/topod-installed-activation'
import { pruneManagedTopodVersions } from './topod-managed-version-gc'
import { tunneledTopodPairingCode } from './topod-tunneled-pairing'
import { resolveTopodMigrationFence } from '../../ssh/migration-source/topod-migration-source-fence'
import type { SshTarget } from '../../../shared/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/remote-runtime/host-catalog/runtime-environment-name-collision'
import { deployedTopodTunnelChecks } from './topod-managed-tunnel-identity'
import {
  isForceableTopodDeferral,
  managedTopodDeployPolicy,
  managedTopodSlot,
  probeManagedTopodReadiness,
  requireManagedTopodInfrastructure
} from './topod-managed-runtime-context'

export async function createManagedTopodEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<TopodManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedTopodInfrastructure()
    const environmentId =
      getManagedTopodFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    // Duplicate/name checks before an add: a crash-zeroed list (#18766) must read as empty here.
    const environments = listEnvironments(userDataPath, { recoverBlankStore: true })
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getTopodSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.topodProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error('The SSH registration for this host’s Topo server has no durable generation.')
    }
    if (registered && getTopodSshDeployment(registered)?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved Topo server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveTopodRemoteContext(claimed, connection, args.signal)
      const slot = managedTopodSlot(context, TOPOD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedTopodActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readTopodActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureTopodManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s Topo server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localTopodDir = await materializeTopodArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localTopodDir)
      const adopted = args.force
        ? null
        : await adoptRunningTopodVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readTopodActivationRecord(slot) }
      }
      const serving: DeployedTopod | TopodManagedDeferral =
        adopted ??
        (await deployOwnTopod(context, { ...slot, conn: connection }, localTopodDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedTopodTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startTopodManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: TOPOD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedTopodEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledTopodPairingCode(tunnel.readiness(), localPort),
        topodDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: TOPOD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeTopodManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedTopod = TopodRunningAdoption & { created?: true }

async function deployOwnTopod(
  context: TopodRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedTopodSlot>,
  localTopodDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedTopod | TopodManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployTopod({
    ...slot,
    localTopodDir,
    target: context.serverTarget,
    ...managedTopodDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableTopodDeferral(deployResult.code) ||
        deployResult.code === TOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveTopod(slot)
  }
  const reprobe = () =>
    probeManagedTopodReadiness(context, localTopodDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedTopodVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveTopodMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('topod_migration_fence_required')
  }
}
