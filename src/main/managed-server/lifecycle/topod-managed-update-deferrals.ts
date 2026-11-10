import type { TopodManagedDeferral } from '../../../shared/topod-managed-runtime'
import type { TopodActivationRecord } from '../activation/topod-activation-record'

type RecordedDeferral = TopodManagedDeferral & { deferredAt: string }

/** Which activation a host is on: a version alone repeats when a host moves away and back. */
export type TopodIncumbent = Pick<TopodActivationRecord, 'active' | 'activatedAt'>

type StoredDeferral = RecordedDeferral & {
  /** The host's activation when the deferral was recorded. */
  incumbentAtDeferral: TopodIncumbent
}

const deferrals = new Map<string, StoredDeferral>()

export function recordManagedTopodUpdateDeferral(
  environmentId: string,
  deferral: TopodManagedDeferral,
  incumbent: TopodIncumbent,
  now = new Date()
): void {
  deferrals.set(environmentId, {
    ...deferral,
    deferredAt: now.toISOString(),
    incumbentAtDeferral: { active: incumbent.active, activatedAt: incumbent.activatedAt }
  })
}

export function clearManagedTopodUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

/** Forget a deferral once the host's activation moves, since it described a host state that is gone
 *  (builds of one release differ only by an unorderable content hash, #38400), or once its candidate
 *  is the build the host runs, since nothing is left to update. */
export function currentManagedTopodUpdateDeferral(
  environmentId: string,
  incumbent: TopodIncumbent
): RecordedDeferral | null {
  const stored = deferrals.get(environmentId)
  if (!stored) {
    return null
  }
  const { incumbentAtDeferral, ...deferral } = stored
  if (
    incumbent.active === deferral.candidateVersion ||
    incumbentAtDeferral.active !== incumbent.active ||
    incumbentAtDeferral.activatedAt !== incumbent.activatedAt
  ) {
    clearManagedTopodUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
