import { compareAppVersions, isValidAppVersion } from '../../../shared/app-version'
import type { TopodActivationRecord } from '../activation/topod-activation-record'
import {
  refuseTopodHostDowngrade,
  type TopodHostVersionRefusal
} from '../activation/topod-host-version-admission'

export type ManagedTopodAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | TopodHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type TopodUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedTopodAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedTopodAutoUpdateSkip }

export function planManagedTopodAutoUpdate(input: {
  record: TopodActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedTopodAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseTopodHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planTopodUpdateForIntent(
  intent: TopodUpdateIntent,
  input: Parameters<typeof planManagedTopodAutoUpdate>[0]
): ManagedTopodAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedTopodAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedTopodAutoUpdate({ ...input, record, failedBefore: false })
}

export function admitTopodRecordForIntent(
  intent: TopodUpdateIntent,
  appVersion: string
): (record: TopodActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    topodUpdateSkipRefusal(
      planTopodUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function topodUpdateSkipRefusal(
  plan: ManagedTopodAutoUpdatePlan,
  record: TopodActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `Topo ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `Topo (${appVersion}). Update Topo to start it.`
}

/** Content hashes cannot order updates: compare Topo versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedTopodUpdate(input: {
  record: TopodActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedTopodAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}
