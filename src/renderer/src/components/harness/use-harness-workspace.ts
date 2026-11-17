import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'

export type HarnessWorkspaceContext = {
  worktreeId: string | null
  repoId: string | null
  name: string
}

/** Runs target the active workspace; its repository decides which flow overrides apply. */
export function useHarnessWorkspace(): HarnessWorkspaceContext {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  const worktree = useAppStore((state) =>
    state.activeWorktreeId ? findWorktreeById(state, state.activeWorktreeId) : null
  )
  return {
    worktreeId,
    repoId: worktree?.repoId ?? null,
    name: worktree?.displayName ?? worktreeId ?? ''
  }
}
