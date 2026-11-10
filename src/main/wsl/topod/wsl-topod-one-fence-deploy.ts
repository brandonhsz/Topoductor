/**
 * A same-version WSL connect takes one activation fence instead of two: the deploy confirms the
 * slot is installed and skips its own fence, then the wake's fence re-reads the record and starts
 * the slot if it stopped. A fence the snapshot saw held, another version active by then, or a busy
 * fence all run the full deploy and wake, as before.
 */
import type { TopodActivationRecord } from '../../managed-server/activation/topod-activation-record'
import { wakeExpectedTopodUnderOneFence } from '../../managed-server/lifecycle/topod-managed-wake'
import type {
  TopodDeployOptions,
  TopodDeployResult
} from '../../managed-server/install/topod-remote-deploy'
import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'

type DeployExtra = Pick<TopodDeployOptions, 'preRead' | 'sameVersionFencedByCaller'>

export async function deployWslTopodWithOneFence(
  slot: TopodSlotOptions,
  deploy: (extra: DeployExtra) => Promise<TopodDeployResult>,
  hinted: { preRead?: { record: TopodActivationRecord; fenceOpen: boolean } }
): Promise<{ deployed: TopodDeployResult; woken: boolean }> {
  if (!hinted.preRead?.fenceOpen) {
    return { deployed: await deploy(hinted), woken: false }
  }
  const first = await deploy({ ...hinted, sameVersionFencedByCaller: true })
  if (first.outcome !== 'already-active') {
    return { deployed: first, woken: false }
  }
  const wake = await wakeExpectedTopodUnderOneFence(slot, first.fullVersion)
  if (wake.outcome === 'replan' || wake.outcome === 'fenced') {
    // The host moved since the snapshot, so this deploy takes no hints.
    return { deployed: await deploy({}), woken: false }
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return { deployed: first, woken: true }
}
