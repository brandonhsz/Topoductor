export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

export type TopoHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: TopoDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: TopoVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: TopoVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: TopoWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type TopoWorktreeDefaults = {
  // Share large rebuildable directories such as node_modules across worktrees instead of copying installs.
  sharedDirectories?: string[]
}

export type TopoDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'orca-worktree' | 'provisioned-root'

export type TopoVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
  // Per-mode wall-clock limits; topo.yaml accepts one number for every mode or a per-mode map.
  timeoutSeconds?: TopoVmRecipeTimeoutSeconds
}

export type TopoVmRecipeLifecycleMode = 'create' | 'suspend' | 'resume' | 'destroy'

export type TopoVmRecipeTimeoutSeconds = Partial<Record<TopoVmRecipeLifecycleMode, number>>

export type TopoVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Retain the old hook-UI mode so persisted state reads without migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedTopoHookEntry = {
  contentHash: string
  approvedAt: number
  /** Earlier approvals, newest first, so switching between branches' scripts doesn't re-prompt. */
  previousContentHashes?: string[]
}

export type PersistedTrustedTopoHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedTopoHookEntry
  archive?: PersistedTrustedTopoHookEntry
  issueCommand?: PersistedTrustedTopoHookEntry
  vmRecipe?: PersistedTrustedTopoHookEntry
}

export type PersistedTrustedTopoHooks = Record<string, PersistedTrustedTopoHookRepo>
