import type { WslHostDeferredUpdate } from '../../../shared/wsl-host-types'
import type { WslTopodLaunch, WslTopodDeployOptions } from './wsl-topod-launch-contract'
/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../../shared/app-environment'

import { TOPOD_MANAGED_REMOTE_PORT } from '../../../shared/topod-managed-runtime'
import type { ServeReadiness } from '../../server/serve-readiness'

import { recoverInterruptedTopodActivation } from '../../managed-server/activation/topod-activation-recovery'
import { readTopodActivationRecord } from '../../managed-server/activation/topod-activation-record-store'
import { materializeTopodArtifact } from '../../topod/topod-artifact-materializer'
import type { TopodHostTransport } from '../../managed-server/install/topod-host-transport'
import { TOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../../managed-server/activation/topod-installed-activation'
import { topodBoundPort } from '../../managed-server/lifecycle/topod-managed-bound-port'
import {
  isForceableTopodDeferral,
  managedTopodDeployPolicy,
  managedTopodSlot
} from '../../managed-server/lifecycle/topod-managed-runtime-context'
import { isWaitingTopodUpdateDeferral } from '../../managed-server/lifecycle/topod-managed-auto-update'
import { clearTopodUpdateFailedThisLaunch } from '../../managed-server/lifecycle/topod-managed-update-failure-memory'
import type { TopodUpdateIntent } from '../../managed-server/lifecycle/topod-managed-update-decision'
import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import { errorMessage } from '../../../shared/error-message'
import { pruneWslTopodVersionsUntilClean } from './wsl-topod-version-gc-memo'
import { pruneSupersededTopodCandidates } from '../../managed-server/lifecycle/topod-managed-version-gc'
import { wakeAlreadyActiveTopod } from '../../managed-server/lifecycle/topod-already-active-wake'
import { TopodActiveReadinessError } from '../../managed-server/activation/topod-active-readiness'
import { WslDistroNotRunningError } from './wsl-topod-connection-errors'
import {
  deployTopod,
  type TopodDeployOptions
} from '../../managed-server/install/topod-remote-deploy'
import { isWslMoveUnderwayOnHost } from '../../persistence/moving-wsl-projects/wsl-move-running-moves'
import { readLocalFullVersion } from '../../managed-server/install/remote-versioned-install'
import { createWslDistroHolder } from '../discovery/wsl-distro-holder'

import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import { readWslDistroRegistryIdShared } from '../discovery/wsl-distro-registry-id'
import type { WslTopodHostTarget } from './wsl-topod-host-target'
import { createWslTopodHostTransport, type WslTopodHostTransport } from './wsl-topod-host-transport'
import { holdWslDistroWithContext } from './wsl-topod-held-context'
import { deployWslTopodWithOneFence } from './wsl-topod-one-fence-deploy'
import { removeFailedFreshWslTopodInstall } from './wsl-topod-failed-install-removal'
import { probeWslActiveTopod, readWslTopodPid } from './wsl-topod-active-probe'
import { wslTopodConnectStateHints } from './wsl-topod-connect-state-snapshot'
import { readWslTopodIncumbent, type WslTopodIncumbent } from './wsl-topod-incumbent'
import { adoptUnrecordedWslTopod } from './wsl-topod-instance-adoption'
import {
  admitWslTopodLaunch,
  readRestoredWslTopodRecord,
  recordWslTopodUpdateFailure,
  wslTopodDeferralCode,
  wslTopodDeferralFailure
} from './wsl-topod-update-admission'
import { withOwnBuildLaunchEnv } from './wsl-topod-own-build-launch-env'
import { WSL_NODE_RUNTIME_DOWNLOAD_BUDGET } from '../execution/wsl-node-runtime-download-budget'

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export function defaultWslTopodEnvironmentId(distro: string): string {
  return `wsl:${wslDistroHolderKey(distro)}`
}

export async function deployAndLaunchWslTopod(
  distro: string,
  options: WslTopodDeployOptions = {}
): Promise<WslTopodLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslTopodHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslTopodEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = (options.createTransport ?? defaultTransport)(target)
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslTopodHostTarget,
  transport: TopodHostTransport,
  options: WslTopodDeployOptions
): Promise<WslTopodLaunch> {
  const { signal } = options
  let ownBuildVersion: string | null = null
  // Set by the serving probe; readyLaunch reads the pid itself for any other version.
  let probed: { fullVersion: string; pid: number | null } | null = null
  const conn = withOwnBuildLaunchEnv(transport, () => ownBuildVersion)
  // Acquire a holder before launch or WSL can idle-stop topod's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  const first = await holdWslDistroWithContext(name, target, conn, holder, signal)
  const { held, connectState } = first
  let context = first.context
  const hints = wslTopodConnectStateHints(connectState, context.activationRecord)
  const slot = managedTopodSlot(context, TOPOD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedTopodActivation(slot, connectState ?? undefined)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readTopodActivationRecord(slot) }
  }
  // Adopt unrecorded topod before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslTopod(
    slot,
    context.activationRecord,
    undefined,
    hints.instanceLock(context.activationRecord)
  )
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  const localTopodDir = await materializeTopodArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localTopodDir)
  ownBuildVersion = candidateVersion
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: TopodActivationRecord, admitIntent: TopodUpdateIntent) =>
    admitWslTopodLaunch(
      {
        slot,
        record,
        candidateVersion,
        appVersion,
        host: failureHost,
        intent: admitIntent,
        moveRunning: isWslMoveUnderwayOnHost(userDataPath(), name)
      },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslTopodIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslTopodIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployOnce = (extra: Partial<TopodDeployOptions>) =>
    deployTopod({
      ...slot,
      conn,
      localTopodDir,
      target: context.serverTarget,
      ...managedTopodDeployPolicy(context, appVersion, intent),
      ...(incumbent
        ? {
            census: incumbent.census,
            recountCensus: incumbent.recount,
            releaseIncumbentAdmission: incumbent.releaseAdmission
          }
        : {}),
      force: intent === 'force',
      appVersion,
      recordedNodeRuntimeProbe: true,
      nodeRuntimeDownload: WSL_NODE_RUNTIME_DOWNLOAD_BUDGET,
      ...extra
    }).catch((error: unknown) => {
      if (!signal?.aborted) {
        recordWslTopodUpdateFailure(failureHost, incumbentVersion, {
          code: 'topod_update_failed',
          reason: errorMessage(error)
        })
      }
      throw error
    })
  const { deployed, woken } = await deployWslTopodWithOneFence(
    slot,
    deployOnce,
    hints.deployPreRead(context.activationRecord)
  )
  if (deployed.outcome === 'installed-not-activated') {
    await removeFailedFreshWslTopodInstall(slot, deployed)
    const failure = wslTopodDeferralFailure(deployed)
    recordWslTopodUpdateFailure(failureHost, incumbentVersion, failure)
    const restored =
      incumbentVersion && failure ? await readRestoredWslTopodRecord(slot, incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslHostDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslTopodDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      forceable:
        isForceableTopodDeferral(deployed.code) ||
        deployed.code === TOPOD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingTopodUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readTopodActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      await pruneSupersededTopodCandidates(slot, context.serverTarget, deployed.fullVersion)
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearTopodUpdateFailedThisLaunch(failureHost)
  const probe = async () => {
    const answer = await probeWslActiveTopod(context, localTopodDir, deployed.fullVersion, signal)
    probed = { fullVersion: deployed.fullVersion, pid: answer.pid }
    return answer.readiness
  }
  let readiness: ServeReadiness
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it; the one-fence deploy already woke it.
    await (woken ? null : wakeAlreadyActiveTopod(slot))
    // Why once more: on a distro still booting, the topod the wake saw serving can exit before
    // the probe; that is a stopped slot to start, not a failed connect.
    readiness = await probe().catch(async (error: unknown) => {
      if (!(error instanceof TopodActiveReadinessError) || error.verdict !== 'exited') {
        throw error
      }
      // A `wsl --shutdown` during a no-boot connect must not be undone by this second wake.
      if (options.requireRunning && !(await options.requireRunning())) {
        throw new WslDistroNotRunningError(name)
      }
      await wakeAlreadyActiveTopod(slot)
      return probe()
    })
  } else {
    readiness = await probe()
  }
  await pruneWslTopodVersionsUntilClean(target.id, {
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  return readyLaunch({ fullVersion: deployed.fullVersion, readiness })

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslTopodLaunch, { outcome: 'ready' }>> {
    // The serving probe already read it; an admission that serves an incumbent did not.
    const pid =
      probed?.fullVersion === serving.fullVersion
        ? probed.pid
        : await readWslTopodPid(context, serving.fullVersion, signal)
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: topodBoundPort(serving.readiness) ?? TOPOD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function defaultTransport(target: WslTopodHostTarget): WslTopodHostTransport {
  return createWslTopodHostTransport({ target })
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
