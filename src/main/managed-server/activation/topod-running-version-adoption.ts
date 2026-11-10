/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../../server/serve-readiness'
import type { TopodManagedDeferral } from '../../../shared/topod-managed-runtime'
import { topodActivationFenceRefusal } from './topod-activation-fence-hold'
import { TopodActiveReadinessError, probeActiveTopodReadiness } from './topod-active-readiness'
import type { TopodActivationRecord } from './topod-activation-record'
import { readTopodActivationRecord } from './topod-activation-record-store'
import { wakeStoppedManagedTopod } from '../lifecycle/topod-managed-wake'
import { resolveTopodSlotIdentity, type TopodSlotOptions } from './topod-recovery-slot'

export type TopodRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census (#28833). */
export async function adoptRunningTopodVersion(
  slot: TopodSlotOptions,
  record: TopodActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<TopodRunningAdoption | TopodManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedTopod(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await topodActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningTopodVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new TopodActiveReadinessError(
        'unverifiable',
        `Topo ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readTopodActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveTopodSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveTopodReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
