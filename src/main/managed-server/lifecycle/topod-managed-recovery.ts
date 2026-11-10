import { redactRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { TopodManagedRecoveryResult } from '../../../shared/topod-managed-runtime'
import { recoverInterruptedTopodActivation } from '../activation/topod-activation-recovery'
import { managedTopodSlot, resolveLinkedTopodContext } from './topod-managed-runtime-context'

import { refreshMaintainedTopodPairing } from './topod-maintenance-pairing-refresh'
import type { LifecycleArgs } from './topod-managed-lifecycle'
import { withManagedTopodLifecycle, followLaunchedServerPort } from './topod-managed-lifecycle'

export function recoverManagedTopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<TopodManagedRecoveryResult> {
  return withManagedTopodLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedTopodContext(environment, deployment, args.signal)
      const result = await recoverInterruptedTopodActivation({
        ...managedTopodSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? refreshMaintainedTopodPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}
