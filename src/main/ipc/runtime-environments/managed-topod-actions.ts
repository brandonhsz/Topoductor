import {
  cancelManagedTopodStop,
  forgetManagedTopodEnvironment,
  forgetRedundantManagedTopodEnvironment,
  stopManagedTopodEnvironment
} from '../../managed-server/lifecycle/topod-runtime-decommission'
import { getManagedTopodRuntimeStatus } from '../../managed-server/lifecycle/topod-runtime-status'
import { recoverManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-managed-recovery'
import { rollbackManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-managed-rollback'
import { updateManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-runtime-maintenance'
import { getTopodSshDeployment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type {
  TopodManagedRestartResult,
  TopodManagedStaleLockReclaimRequest,
  TopodManagedStaleLockReclaimResult
} from '../../../shared/topod-managed-runtime'
import { restartManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-managed-launch-session'
import { forgetManagedTopodAutomaticFailures } from '../../managed-server/lifecycle/topod-managed-tunnel'
import { runManagedTopodStaleLockReclaim } from '../../managed-server/lifecycle/topod-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../ssh/ssh-host-launch-session-note'
import {
  liftUserHoldsForServerAction,
  resumeRuntimeEnvironmentStatus
} from '../ssh/ssh-host-user-disconnect'
import { releaseUnlinkedHostTransport } from '../ssh/ssh-session-teardown'
import type { ManagedServerActions } from '../../runtime/hosts/management/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from './runtime-environment-removal-cleanup'

export type ManagedTopodActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedTopodActions(
  options: ManagedTopodActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      ),
    releaseHostTransport: releaseUnlinkedHostTransport
  }
  return {
    status: (selector) => getManagedTopodRuntimeStatus(userDataPath(), selector),
    update: (selector, force, pastLiveTerminals) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await updateManagedTopodEnvironment(userDataPath(), {
          selector,
          force,
          ...(pastLiveTerminals ? { pastLiveTerminals } : {})
        })
        if (result.outcome === 'updated') {
          await options.invalidateTransport(result.environment.id)
        }
        if (result.outcome !== 'deferred') {
          const targetId = getTopodSshDeployment(result.environment)?.sshTargetId
          if (targetId) {
            options.clearHostServerNotes(targetId, result.environment.id)
          }
        }
        return result
      }),
    rollback: (selector) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await rollbackManagedTopodEnvironment(userDataPath(), { selector })
        if (result.outcome === 'rolled-back') {
          await options.invalidateTransport(result.environment.id)
        }
        return result
      }),
    recover: (selector, acceptChangedState) =>
      asExplicitServerAction(userDataPath(), selector, async () => {
        const result = await recoverManagedTopodEnvironment(userDataPath(), {
          selector,
          acceptChangedState: acceptChangedState === true
        })
        if (result.outcome === 'recovered' && result.activeVersion) {
          await options.invalidateTransport(result.environment.id)
        }
        return result
      }),
    stop: async (selector) => {
      const result = await stopManagedTopodEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: (selector) => cancelManagedTopodStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedTopodEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    forgetRedundant: async (selector) => {
      const result = await forgetRedundantManagedTopodEnvironment(
        userDataPath(),
        { selector },
        unlinkPolicy
      )
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedTopod(
  options: ManagedTopodActionOptions,
  selector: string
): Promise<TopodManagedRestartResult> {
  return asExplicitServerAction(options.getUserDataPath(), selector, async () => {
    const result = await restartManagedTopodEnvironment(options.getUserDataPath(), selector)
    if (result.outcome === 'restarted') {
      await reconnectRestartedManagedTopod(options, result.environmentId)
    }
    return result
  })
}

export async function reclaimManagedTopodStaleLock(
  options: ManagedTopodActionOptions,
  selector: string,
  request: TopodManagedStaleLockReclaimRequest
): Promise<TopodManagedStaleLockReclaimResult> {
  const result = await runManagedTopodStaleLockReclaim(options.getUserDataPath(), selector, request)
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedTopod(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedTopod(
  options: ManagedTopodActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getTopodSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}

/** A user's Update, Rollback, Recover or Restart is a Connect: it re-arms automatic starts and lifts a Disconnect. */
async function asExplicitServerAction<T>(
  userDataPath: string,
  selector: string,
  action: () => Promise<T>
): Promise<T> {
  let lifted: string[] = []
  try {
    const environment = resolveEnvironment(userDataPath, selector)
    forgetManagedTopodAutomaticFailures(userDataPath, environment.id)
    lifted = liftUserHoldsForServerAction(environment)
  } catch {
    // An unknown selector fails in the action itself with its own error.
  }
  try {
    // `action` includes its transport invalidation, so resumed status never probes the old transport.
    return await action()
  } finally {
    resumeLiftedStatus(lifted)
  }
}

function resumeLiftedStatus(environmentIds: readonly string[]): void {
  try {
    resumeRuntimeEnvironmentStatus(environmentIds)
  } catch (error) {
    // A server removed during the action has no status to resume; keep the action's own result.
    console.warn('[managed-topod] Could not resume status after an explicit action:', error)
  }
}
