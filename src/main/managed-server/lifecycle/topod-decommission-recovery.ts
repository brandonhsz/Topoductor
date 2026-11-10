import { writeTopodActivationRecord } from '../activation/topod-activation-record-store'
import type { TopodActivationRecoveryResult } from '../activation/topod-activation-recovery'
import type { TopodDecommissionRecoveryPlan } from './topod-decommission-transaction'
import { settleTopodDecommissionStop } from './topod-decommission-stop'
import {
  topodLivenessProbeCommand,
  topodLivenessProvenExited,
  parseTopodLiveness
} from '../install/topod-remote-launch'
import { execTopodRemote } from '../install/topod-remote-runtime-control'
import {
  ensureTopodSlotServing,
  topodSlotDir,
  resolveTopodSlotIdentity,
  type TopodSlotOptions
} from '../activation/topod-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileTopodDecommission(
  options: TopodSlotOptions,
  plan: TopodDecommissionRecoveryPlan
): Promise<TopodActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveTopodSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureTopodSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleTopodDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'topod_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileTopodDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileTopodDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseTopodLiveness(
    await execTopodRemote(
      options,
      topodLivenessProbeCommand(options.host, topodSlotDir(options, plan.version))
    )
  )
  if (!topodLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'topod_recovery_decommissioned_slot_not_exited',
      reason: `topod ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeTopodActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
