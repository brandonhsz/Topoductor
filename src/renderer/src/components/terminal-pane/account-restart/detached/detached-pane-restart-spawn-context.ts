import {
  selectWorktreesByRepo,
  selectFolderWorkspaces
} from '@/store/workspaces/catalog/workspace-record-fields'
import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { makePaneKey } from '../../../../../../shared/workspace-layout/stable-pane-id'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'

export function getWorkspacePath(state: AppState, worktreeId: string): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  return parsed?.type === 'folder'
    ? (selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null)
    : (getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(worktreeId)?.path ?? null)
}

export function buildPaneIdentityEnv(
  state: AppState,
  worktreeId: string,
  tabId: string,
  leafId: string
): Record<string, string> {
  const parsed = parseWorkspaceKey(worktreeId)
  const folderWorkspace =
    parsed?.type === 'folder'
      ? selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
      : null
  return {
    TOPO_WORKSPACE_ID: worktreeId,
    ...(folderWorkspace
      ? {
          TOPO_PROJECT_GROUP_ID: folderWorkspace.projectGroupId,
          TOPO_WORKSPACE_ROOT: folderWorkspace.folderPath
        }
      : {}),
    TOPO_PANE_KEY: makePaneKey(tabId, leafId),
    TOPO_TAB_ID: tabId,
    TOPO_WORKTREE_ID: worktreeId
  }
}
