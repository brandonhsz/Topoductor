import {
  isRetainedTopodMigrationSourceCutover,
  type TopodMigrationSourceCutover
} from '../../../shared/topod-migration/topod-migration-source-cutover'
import {
  getTopodSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listTopodMigrationSourceCutovers } from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'

type TopodManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: TopodMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedTopodMigrations(
  userDataPath: string
): TopodManagedPendingMigration[] {
  return (
    listTopodMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedTopodMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedTopodMigration(
  userDataPath: string,
  environmentId: string
): TopodManagedPendingMigration | null {
  return (
    listPendingManagedTopodMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedTopodCutover(
  environment: KnownRuntimeEnvironment,
  cutover: TopodMigrationSourceCutover
): boolean {
  const deployment = getTopodSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
