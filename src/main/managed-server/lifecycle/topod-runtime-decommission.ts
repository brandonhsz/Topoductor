// Keep claims, tunnels and registration until the host proves server exit.
import type {
  TopodManagedCancelStopResult,
  TopodManagedForgetResult,
  TopodManagedStopResult
} from '../../../shared/topod-managed-runtime'
import type { TopodDaemonRetirementVerdict } from '../../../shared/topod-stop-request'
import { removeManagedTopodEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findManagedSshTwin } from '../../../shared/remote-runtime/host-catalog/runtime-environment-host-key-match'
import type {
  KnownRuntimeEnvironment,
  TopodSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { recoverInterruptedTopodActivation } from '../activation/topod-activation-recovery'
import { withStaleTopodActivationRecoveryLock } from '../activation/topod-activation-lock'
import { readTopodActivationTransaction } from '../activation/topod-activation-transaction-store'
import { reconcileTopodDecommission } from './topod-decommission-recovery'
import { cancelRemoteTopodManagedStop } from './topod-managed-remote-stop'
import {
  managedTopodSlot,
  requireManagedTopodInfrastructure,
  resolveLinkedTopodContext
} from './topod-managed-runtime-context'
import { closeTopodManagedTunnel, ensureTopodManagedTunnel } from './topod-managed-tunnel'
import { clearManagedTopodUpdateDeferral } from './topod-managed-update-deferrals'
import { removeTopodMigrationJournalsForDestination } from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import { decommissionRemoteTopod } from '../install/topod-remote-decommission'
import { withManagedTopodLifecycle } from './topod-managed-lifecycle'
import { collectManagedTerminalCensus } from './topod-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedTopodStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
  /** Runs inside the host's lifecycle, so a Connect queued behind the unlink still wins. */
  releaseHostTransport: (sshTargetId: string) => Promise<void>
}

type Refusal = Extract<TopodManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: TopodDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export function stopManagedTopodEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedTopodStopPolicy
): Promise<TopodManagedStopResult> {
  return withManagedTopodLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'topod_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export function forgetManagedTopodEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedTopodStopPolicy
): Promise<TopodManagedForgetResult> {
  return withManagedTopodLifecycle(userDataPath, args.selector, (managed) =>
    forgetLinkedEnvironment(userDataPath, managed, policy)
  )
}

/** Forget one of two saved entries for one managed server; the other keeps managing it, so the host is not contacted. */
export function forgetRedundantManagedTopodEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedTopodStopPolicy
): Promise<TopodManagedForgetResult> {
  return withManagedTopodLifecycle(userDataPath, args.selector, (managed) => {
    // Checked in the queue and unlinked in the same tick, so two Removes cannot each count the other as the twin.
    if (!findManagedSshTwin(listEnvironments(userDataPath), managed.environment)) {
      return Promise.resolve(
        refuse(
          'live',
          'topod_forget_no_managed_twin',
          'No other saved entry manages this server anymore, so removing this one would leave it unmanaged. Stop it instead.'
        )
      )
    }
    return forgetLinkedEnvironment(userDataPath, managed, policy)
  })
}

async function forgetLinkedEnvironment(
  userDataPath: string,
  {
    environment,
    deployment
  }: { environment: KnownRuntimeEnvironment; deployment: TopodSshDeploymentLink },
  policy: ManagedTopodStopPolicy
): Promise<TopodManagedForgetResult> {
  if (policy.isActiveEnvironment(environment.id)) {
    return refuse(
      'live',
      'topod_forget_active_environment',
      'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
    )
  }
  await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
  return {
    outcome: 'forgotten',
    verdict: 'unverifiable',
    environmentId: environment.id,
    sshTargetId: deployment.sshTargetId
  }
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: TopodSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedTopodContext(environment, deployment, signal)
  const slot = managedTopodSlot(context, deployment.remotePort, signal)
  const transaction = await readTopodActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedTopodActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'topod_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'topod_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'topod_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteTopod({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: TopodSshDeploymentLink,
  policy: ManagedTopodStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  removeManagedTopodEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeTopodManagedTunnel(environment.id)
  const { claims } = requireManagedTopodInfrastructure()
  claims.releaseForUserRemoval(deployment.sshTargetId, environment.id)
  clearManagedTopodUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeTopodMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
  // No server serves the host now, and an unserved host never stays connected.
  await policy.releaseHostTransport(deployment.sshTargetId)
}

export function cancelManagedTopodStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<TopodManagedCancelStopResult> {
  return withManagedTopodLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedTopodContext(environment, deployment, args.signal)
    const slot = managedTopodSlot(context, deployment.remotePort, args.signal)
    let result: TopodManagedCancelStopResult
    try {
      result = await withStaleTopodActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readTopodActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteTopodManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'topod_stop_already_dispatched',
              reason: 'topod already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileTopodDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'topod_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'topod_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureTopodManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
