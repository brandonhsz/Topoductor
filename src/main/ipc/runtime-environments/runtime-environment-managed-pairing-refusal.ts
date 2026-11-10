import { errorMessage } from '../../../shared/error-message'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { getTopodSshDeployment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { managedTopodRefusalNeedingUserCode } from '../../managed-server/lifecycle/topod-managed-tunnel-identity'
import {
  managedTopodPairingFailureStands,
  recoverRefusedManagedTopodPairing
} from '../../managed-server/lifecycle/topod-managed-tunnel'
import { getRuntimeEnvironmentStatusOwner } from './runtime-environment-request-connections'

/** Null leaves user-managed pairing recovery to the caller. */
export function recoverRefusedManagedPairing(
  userDataPath: string,
  environmentId: string,
  recover: typeof recoverRefusedManagedTopodPairing = recoverRefusedManagedTopodPairing
): Promise<'built' | 'repaired'> | null {
  try {
    if (!getTopodSshDeployment(resolveEnvironment(userDataPath, environmentId))) {
      return null
    }
  } catch {
    return null
  }
  return recover(userDataPath, environmentId)
}

/** Null preserves ordinary reconnect; a promise owns the refused socket recovery. */
export function handleManagedSharedControlRefusal(
  userDataPath: string,
  environmentId: string,
  recover: typeof recoverRefusedManagedTopodPairing = recoverRefusedManagedTopodPairing,
  failureStands: typeof managedTopodPairingFailureStands = managedTopodPairingFailureStands
): Promise<'retry' | 'stop'> | null {
  const recovery = recoverRefusedManagedPairing(userDataPath, environmentId, recover)
  if (!recovery) {
    return null
  }
  return recovery.then(
    // A re-pair retired this socket for one on the new pairing; otherwise retry with backoff.
    (outcome) => (outcome === 'repaired' ? 'stop' : 'retry'),
    (error: unknown) => {
      // A concurrent pairing has a successor owner this failure never judged.
      const code = managedTopodRefusalNeedingUserCode(error)
      if (code && error instanceof Error && failureStands(userDataPath, environmentId)) {
        // Authentication refusal blocks retries until an explicit user connect.
        try {
          getRuntimeEnvironmentStatusOwner(userDataPath, environmentId).authenticationRejected(
            error.message,
            code
          )
        } catch {
          // Removed while it re-paired: nothing is left to report on.
        }
        return 'stop'
      }
      // Lost contact or a foreign answer is not a verdict on the pairing.
      console.warn(
        '[runtime-environments] Could not re-pair the managed Topo server:',
        errorMessage(error)
      )
      return 'retry'
    }
  )
}
