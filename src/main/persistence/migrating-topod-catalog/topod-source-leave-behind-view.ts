// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { collectTopodMigrationUntransferredDependencyCensus } from './topod-source-dependency-census'
import { collectTopodMigrationSourceDormantState } from './topod-source-dormant-state'
import type { TopodMigrationDeltaView } from './topod-source-delta-view'

export function createTopodMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): TopodMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectTopodMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectTopodMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectTopodMigrationUntransferredDependencies: (manifest) =>
      collectTopodMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
