import { getAppEnvironment } from '../../../shared/app-environment'
import type { ManagedServerUpdateDeps } from './managed-server-update-check'
import { autoUpdateManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-managed-auto-update'
import { requireManagedTopodTargetStore } from '../../managed-server/lifecycle/topod-managed-runtime-context'
import {
  topodUpdateFailedThisLaunch,
  recordTopodUpdateFailedThisLaunch
} from '../../managed-server/lifecycle/topod-managed-update-failure-memory'

export function managedServerUpdateDeps(userDataPath: string): ManagedServerUpdateDeps {
  const registry = requireManagedTopodTargetStore()
  const appVersion = getAppEnvironment().getVersion()
  return {
    autoUpdate: (environmentId, options) =>
      autoUpdateManagedTopodEnvironment(userDataPath, { environmentId, appVersion, ...options }),
    // Re-read the store: caller snapshots may predate an overlapping check's failure.
    recordedUpdateFailure: (target) => {
      const failure = (registry.getTarget(target.id) ?? target).managedServerUpdateFailure
      return failure?.appVersion === appVersion ? failure.reason : null
    },
    // Only attempted failures suppress retry; keep launch-only state out of peer-published SshTarget.
    failedThisLaunch: (target) => topodUpdateFailedThisLaunch({ kind: 'ssh', id: target.id }),
    recordUpdateFailure: (target, reason) => {
      recordTopodUpdateFailedThisLaunch(
        { kind: 'ssh', id: target.id },
        { code: 'topod_update_failed', reason }
      )
      registry.updateTarget(target.id, { managedServerUpdateFailure: { reason, appVersion } })
    },
    clearUpdateFailure: (target) => {
      registry.updateTarget(target.id, { managedServerUpdateFailure: undefined })
    }
  }
}
