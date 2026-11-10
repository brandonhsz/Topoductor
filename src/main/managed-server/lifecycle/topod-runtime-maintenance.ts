import { getAppEnvironment } from '../../../shared/app-environment'
import { redactRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type {
  TopodManagedDeployResult,
  TopodManagedPastLiveTerminals
} from '../../../shared/topod-managed-runtime'

import { materializeTopodArtifact } from '../../topod/topod-artifact-materializer'
import { wakeAlreadyActiveTopod } from './topod-already-active-wake'
import {
  clearManagedTopodUpdateDeferral,
  recordManagedTopodUpdateDeferral
} from './topod-managed-update-deferrals'

import {
  isForceableTopodDeferral,
  managedTopodSlot,
  probeManagedTopodReadiness,
  resolveLinkedTopodContext
} from './topod-managed-runtime-context'

import type { requireManagedTopodEnvironment } from './topod-managed-runtime-context'

import type { TopodRemoteContext } from '../install/topod-remote-context'
import { deployTopod } from '../install/topod-remote-deploy'
import type { TopodDeployOptions } from '../install/topod-remote-deploy'
import type { TopodUpdateForce } from '../activation/topod-update-plan'
import { TOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../activation/topod-installed-activation'
import {
  pruneManagedTopodVersions,
  pruneSupersededTopodCandidates
} from './topod-managed-version-gc'

import { clearTopodUpdateFailedThisLaunch } from './topod-managed-update-failure-memory'
import { admitTopodRecordForIntent } from './topod-managed-update-decision'
import { collectManagedTerminalCensus } from './topod-terminal-census-client'
import { updateTerminalCounts } from '../activation/topod-fenced-stop'
import { refreshMaintainedTopodPairing } from './topod-maintenance-pairing-refresh'
import type { LifecycleArgs } from './topod-managed-lifecycle'
import { withManagedTopodLifecycle, followLaunchedServerPort } from './topod-managed-lifecycle'

export function updateManagedTopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: TopodManagedPastLiveTerminals }
): Promise<TopodManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return withManagedTopodLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitTopodRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<TopodDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: TopodUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedTopodUpdate(
      userDataPath,
      managed,
      await resolveLinkedTopodContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearTopodUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedTopodUpdate(
  userDataPath: string,
  { environment, deployment }: ReturnType<typeof requireManagedTopodEnvironment>,
  context: TopodRemoteContext,
  args: {
    force?: TopodUpdateForce
    signal?: AbortSignal
    localTopodDir?: string
    admitRecord?: TopodDeployOptions['admitRecord']
  }
): Promise<TopodManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localTopodDir =
    args.localTopodDir ??
    (await materializeTopodArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedTopodSlot(context, deployment.remotePort, args.signal)
  const result = await deployTopod({
    ...slot,
    localTopodDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableTopodDeferral(result.code) ||
        result.code === TOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== TOPOD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedTopodUpdateDeferral(environment.id, deferral, context.activationRecord)
    }
    await pruneSupersededTopodCandidates(slot, context.serverTarget, result.fullVersion)
    return deferral
  }
  clearManagedTopodUpdateDeferral(environment.id)
  const alreadyActive = result.outcome === 'already-active'
  const managed = { environmentId: environment.id, hostLabel: context.target.label }
  const started = alreadyActive && (await wakeAlreadyActiveTopod(slot, managed))
  const readiness = await probeManagedTopodReadiness(
    context,
    localTopodDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedTopodVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = refreshMaintainedTopodPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}
