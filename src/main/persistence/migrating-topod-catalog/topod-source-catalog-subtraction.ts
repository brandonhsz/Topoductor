// Delta-view copies only: remove still-owned manifest rows; retain groups referenced elsewhere.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import { requireTopodMigrationSshSource } from '../../../shared/topod-migration/topod-migration-source-kind'
import { topodSourceFolderWorkspaceIds, repoBelongsToTopodSource } from './topod-source-ownership'

export function subtractTopodSourceCatalogState(
  state: StoreRuntimeState['state'],
  manifest: TopodMigrationManifest
): void {
  const repoIds = new Set(manifest.payload.repositories.map((repo) => repo.id))
  const folderIds = new Set(manifest.payload.folderWorkspaces.map((workspace) => workspace.id))
  const groupIds = new Set(manifest.payload.projectGroups.map((group) => group.id))
  const targetId = requireTopodMigrationSshSource(manifest.source).sshTargetId
  // Resolve inferred folder ownership before deleting its repos.
  const ownedFolderIds = topodSourceFolderWorkspaceIds(state, targetId)
  state.repos = state.repos.filter(
    (repo) => !(repoIds.has(repo.id) && repoBelongsToTopodSource(repo, targetId))
  )
  state.folderWorkspaces = state.folderWorkspaces.filter(
    (workspace) => !(folderIds.has(workspace.id) && ownedFolderIds.has(workspace.id))
  )
  removeUnreferencedSourceGroups(state, groupIds, targetId)
}

function removeUnreferencedSourceGroups(
  state: StoreRuntimeState['state'],
  candidateIds: ReadonlySet<string>,
  targetId: string
): void {
  let removed = true
  while (removed) {
    removed = false
    const referencedIds = new Set([
      ...state.repos.flatMap((repo) => (repo.projectGroupId ? [repo.projectGroupId] : [])),
      ...state.folderWorkspaces.map((workspace) => workspace.projectGroupId),
      ...state.projectGroups.flatMap((group) => (group.parentGroupId ? [group.parentGroupId] : []))
    ])
    const next = state.projectGroups.filter((group) => {
      const shouldRemove =
        candidateIds.has(group.id) &&
        group.connectionId === targetId &&
        !referencedIds.has(group.id)
      removed ||= shouldRemove
      return !shouldRemove
    })
    state.projectGroups = next
  }
}
