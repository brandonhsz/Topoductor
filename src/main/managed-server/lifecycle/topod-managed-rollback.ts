import { redactRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { TopodManagedRollbackResult } from '../../../shared/topod-managed-runtime'
import { probeActiveTopodReadiness } from '../activation/topod-active-readiness'
import { CURRENT_TOPOD_DAEMON_PROTOCOL } from '../activation/topod-daemon-protocol-crossing'
import {
  managedTopodInstallDir,
  managedTopodSlot,
  resolveLinkedTopodContext
} from './topod-managed-runtime-context'

import { readRemoteTopodBuildHash } from '../install/topod-remote-build-hash'
import { rollbackTopod } from '../install/topod-remote-rollback'
import { collectManagedTerminalCensus } from './topod-terminal-census-client'
import { updateTerminalCounts } from '../activation/topod-fenced-stop'
import { findIncompleteManagedTopodMigration } from './topod-managed-migration-status'
import { latestTopodMigrationInto } from '../../persistence/migrating-topod-catalog/topod-migration-rollback-mark'
import { refreshMaintainedTopodPairing } from './topod-maintenance-pairing-refresh'
import type { LifecycleArgs } from './topod-managed-lifecycle'
import { withManagedTopodLifecycle, followLaunchedServerPort } from './topod-managed-lifecycle'

export function rollbackManagedTopodEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<TopodManagedRollbackResult> {
  return withManagedTopodLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedTopodContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'topod_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedTopodSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedTopodInstallDir(context, target)
      const targetBuildHash = await readRemoteTopodBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'topod_rollback_census_unavailable'
              : 'topod_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackTopod({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_TOPOD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveTopodReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = refreshMaintainedTopodPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): TopodManagedRollbackResult | null {
  if (findIncompleteManagedTopodMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'topod_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestTopodMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'topod_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
