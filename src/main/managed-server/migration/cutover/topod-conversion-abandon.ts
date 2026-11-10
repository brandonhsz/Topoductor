/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedTopodEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { closeTopodManagedTunnel } from '../../lifecycle/topod-managed-tunnel'
import {
  abortTopodMigrationCutover,
  type TopodMigrationAbortResult,
  type TopodMigrationCutoverContext,
  type TopodMigrationDestinationCatalog
} from './topod-migration-cutover-coordinator'
import { findTopodMigrationSourceCutoverForTarget } from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  releaseTopodMigrationFence,
  releaseUndeployedMigrationFence
} from '../../../ssh/migration-source/topod-migration-source-fence'

export async function abandonTopodConversion(args: {
  userDataPath: string
  store: TopodMigrationCutoverContext['store']
  claims: TopodMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => TopodMigrationDestinationCatalog
}): Promise<TopodMigrationAbortResult | 'none'> {
  const cutover = findTopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  const environment = listEnvironments(args.userDataPath).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortTopodMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeTopodManagedTunnel(environment.id).catch(() => undefined)
    removeManagedTopodEnvironment(args.userDataPath, environment.id)
    await releaseTopodMigrationFence(context, aborted)
  })
}
