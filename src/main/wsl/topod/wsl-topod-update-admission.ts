/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  TOPOD_HOST_NEWER_DEFERRAL_CODE,
  TOPOD_UPDATE_WSL_MOVE_RUNNING_CODE,
  type WslHostDeferredUpdate
} from '../../../shared/wsl-host-types'
import { refuseTopodHostDowngrade } from '../../managed-server/activation/topod-host-version-admission'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import { readTopodActivationRecord } from '../../managed-server/activation/topod-activation-record-store'
import { readTopodActivationTransaction } from '../../managed-server/activation/topod-activation-transaction-store'
import { isWaitingTopodUpdateDeferral } from '../../managed-server/lifecycle/topod-managed-auto-update'
import {
  topodUpdateSkipRefusal,
  planTopodUpdateForIntent,
  type ManagedTopodAutoUpdatePlan,
  type TopodUpdateIntent
} from '../../managed-server/lifecycle/topod-managed-update-decision'
import {
  topodUpdateFailureThisLaunch,
  recordTopodUpdateFailedThisLaunch,
  type TopodUpdateFailure,
  type TopodUpdateFailureHost
} from '../../managed-server/lifecycle/topod-managed-update-failure-memory'
import { TOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../../managed-server/activation/topod-installed-activation'
import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'
import { adoptRunningTopodVersion } from '../../managed-server/activation/topod-running-version-adoption'
import type { WslTopodLaunch } from './wsl-topod-launch-contract'

type WslTopodReadyLaunch = Extract<WslTopodLaunch, { outcome: 'ready' }>

export type WslTopodUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: TopodActivationRecord }

export async function admitWslTopodUpdate(args: {
  slot: TopodSlotOptions
  record: TopodActivationRecord
  candidateVersion: string
  appVersion: string
  host: TopodUpdateFailureHost
  intent: TopodUpdateIntent
  /** A project move to this distro runs here: a redeploy would cut it off, even when forced. */
  moveRunning?: boolean
}): Promise<WslTopodUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = topodUpdateFailureThisLaunch(args.host)
  const plan = planTopodUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  const heldForMove = args.moveRunning === true && plan.action === 'update'
  if (!heldForMove && (plan.action !== 'skip' || plan.reason === 'current')) {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningTopodVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readTopodActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : heldForMove
          ? {
              candidateVersion,
              code: TOPOD_UPDATE_WSL_MOVE_RUNNING_CODE,
              reason:
                'A project is moving to this WSL host; its server updates once the move finishes.',
              forceable: false
            }
          : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslTopodLaunch(
  args: Parameters<typeof admitWslTopodUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslTopodReadyLaunch>
): Promise<WslTopodLaunch | TopodActivationRecord> {
  const admission = await admitWslTopodUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedTopodAutoUpdatePlan,
  failure: TopodUpdateFailure | null,
  record: TopodActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? topodUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: TOPOD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslTopodUpdateFailure(
  host: TopodUpdateFailureHost,
  incumbentVersion: string | null,
  failure: TopodUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordTopodUpdateFailedThisLaunch(host, failure)
  }
}

export function wslTopodDeferralFailure(deployed: {
  code: string
  reason: string
}): TopodUpdateFailure | null {
  return isWaitingTopodUpdateDeferral(deployed.code) ||
    deployed.code === TOPOD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer Topo runs gets its own code: an Update cannot pass it. */
export async function wslTopodDeferralCode(
  slot: TopodSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== TOPOD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readTopodActivationRecord(slot).catch(() => null)
  return record && refuseTopodHostDowngrade(record, deployed.fullVersion, appVersion)
    ? TOPOD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}

/** The record only once the incumbent is back and no journal awaits recovery; else null. */
export async function readRestoredWslTopodRecord(
  slot: TopodSlotOptions,
  incumbent: string
): Promise<TopodActivationRecord | null> {
  // Unreadable transaction state proves no restoration; preserve the rejection.
  if (await readTopodActivationTransaction(slot).catch(() => true)) {
    return null
  }
  const record = await readTopodActivationRecord(slot).catch(() => null)
  return record?.active === incumbent ? record : null
}
