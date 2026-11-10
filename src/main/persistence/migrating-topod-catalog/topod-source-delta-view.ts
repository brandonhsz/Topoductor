// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationDormantStatePayload,
  TopodMigrationManifest,
  TopodMigrationManifestSource
} from '../../../shared/topod-migration/topod-migration-manifest'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { subtractTopodSourceCatalogState } from './topod-source-catalog-subtraction'
import {
  collectTopodMigrationUntransferredDependencyCensus,
  type TopodMigrationSourceDependencyCensus
} from './topod-source-dependency-census'
import { subtractTopodMigrationSourceDormantState } from './topod-source-dormant-subtraction'
import { collectTopodMigrationSourceDormantState } from './topod-source-dormant-state'
import { subtractTopodMigrationScopeWorkspaceSession } from './topod-source-workspace-session-subtraction'

export type TopodMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectTopodMigrationSourceDormantState: (
    source: TopodMigrationManifestSource,
    catalog: TopodMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => TopodMigrationDormantStatePayload
  inspectTopodMigrationUntransferredDependencies: (
    manifest: TopodMigrationManifest
  ) => TopodMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createTopodMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: TopodMigrationManifest
): TopodMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractTopodSourceCatalogState(state, moved)
  subtractTopodMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractTopodMigrationScopeWorkspaceSession(state, moved)
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
