import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  topodIdentityRefusal,
  verifyTopodPairingIdentity,
  type TopodTunnelIdentity
} from '../../managed-server/lifecycle/topod-managed-tunnel-identity'
import { tunneledTopodPairingCode } from '../../managed-server/lifecycle/topod-tunneled-pairing'
import { getPreferredPairingOffer } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedTopodPairingRecovery
} from '../../managed-server/lifecycle/topod-managed-tunnel-pairing-recovery'
import type { WslTopodLaunch } from './wsl-topod-launch-contract'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslTopodPairingRecovery = Omit<ManagedTopodPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslTopodPairing(
  launch: Extract<WslTopodLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslTopodIdentity,
  recovery?: WslTopodPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslTopodPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslTopodPairing(
  launch: Extract<WslTopodLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslTopodIdentity
): Promise<string> {
  const pairingOffer = tunneledTopodPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw topodIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] Topo server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the topod that published `readiness`. */
export async function verifyWslTopodIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<TopodTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyTopodPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The Topo server in WSL published an invalid pairing offer.' }
}
