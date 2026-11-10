import type { TopodManagedRuntimeStatus } from '../../../shared/topod-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { TopodActivationTransaction } from '../activation/topod-activation-transaction'
import { readTopodActivationTransaction } from '../activation/topod-activation-transaction-store'
import {
  requireManagedTopodEnvironment,
  resolveLinkedTopodContext
} from './topod-managed-runtime-context'
import { currentManagedTopodUpdateDeferral } from './topod-managed-update-deferrals'
import { findIncompleteManagedTopodMigration } from './topod-managed-migration-status'
import { collectManagedTerminalCensus } from './topod-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-environment'
import { bundledManagedTopodVersion } from './topod-managed-auto-update'
import { availableManagedTopodUpdate } from './topod-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedTopodRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<TopodManagedRuntimeStatus> {
  const { environment, deployment } = requireManagedTopodEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedTopodContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readTopodActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: TopodManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedTopodUpdateDeferral(environment.id, record)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedTopodVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedTopodUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: TopodActivationTransaction
): NonNullable<TopodManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): TopodManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedTopodMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
