import { refreshManagedTopodPairing } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  getTopodSshDeployment,
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { ServeReadiness } from '../../server/serve-readiness'
import { tunneledTopodPairingCode } from './topod-tunneled-pairing'

/** Saves the pairing a managed server published after an update, rollback or restart. */
export function refreshMaintainedTopodPairing(
  userDataPath: string,
  environmentId: string,
  readiness: ServeReadiness
): KnownRuntimeEnvironment {
  // Reuse the enrolled grant after restart so pairing cannot replace this desktop’s identity (#29042).
  // Re-read because census may have repaired pairing or moved the tunnel port meanwhile.
  const current = resolveEnvironment(userDataPath, environmentId)
  const localPort = getTopodSshDeployment(current)?.localPort
  if (localPort === undefined) {
    throw new Error('This server is no longer managed over SSH.')
  }
  const enrolled = getPreferredPairingOffer(current)
  const pairingCode = tunneledTopodPairingCode(readiness, localPort, enrolled)
  return refreshManagedTopodPairing(userDataPath, environmentId, pairingCode)
}
