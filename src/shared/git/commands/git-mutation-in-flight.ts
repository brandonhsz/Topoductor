/** Whether the execution host is running or has queued a Topo Git command that can change this worktree. */
export type GitMutationInFlight = {
  inFlight: boolean
}
