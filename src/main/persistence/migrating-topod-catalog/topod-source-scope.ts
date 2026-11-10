import {
  isTopodMigrationLocalWslSource,
  requireTopodMigrationSshSource
} from '../../../shared/topod-migration/topod-migration-source-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId
} from '../../../shared/execution-host'
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationManifestSource
} from '../../../shared/topod-migration/topod-migration-manifest'
import {
  normalizeWorkspaceSessionKeyToWorkspaceId,
  parseWorkspaceKey
} from '../../../shared/workspace-scope'
import type { PersistedState } from '../../../shared/persisted-state-types'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'
import type { Repo } from '../../../shared/repo-types'
import { ownerKeyBelongsToRepo } from '../../topo-profiles/profile-project-worktree-identity'
import { repoBelongsToTopodSource } from './topod-source-ownership'

type TopodMigrationScopeRows = {
  repoIds: ReadonlySet<string>
  folderWorkspaceKeys: ReadonlySet<string>
  /** Shared bare repo IDs cannot prove host ownership, so never move or subtract them. */
  sharedRepoIds: ReadonlySet<string>
  /** Unqualified keys inherit this partition's host. */
  partitionHostId?: string
}

/** A relay-era SSH target: its rows name the target, and live on the target's host id. */
export type TopodMigrationSshSourceScope = TopodMigrationScopeRows & {
  kind: 'ssh-relay'
  targetId: string
  targetGeneration: number | null
  hostId: ReturnType<typeof toSshExecutionHostId>
}

/** Local projects inside one WSL distro: rows live on host `local`, and no SSH target is involved. */
export type TopodMigrationLocalWslSourceScope = TopodMigrationScopeRows & {
  kind: 'local-wsl'
  targetId: null
  targetGeneration: null
  hostId: typeof LOCAL_EXECUTION_HOST_ID
}

export type TopodMigrationSourceScope =
  | TopodMigrationSshSourceScope
  | TopodMigrationLocalWslSourceScope

/**
 * An SSH conversion moves every row its host holds, so an unmatched host row is an error. A WSL move
 * takes some of host `local`'s projects; the rest are another project's, never this move's.
 */
export function topodMigrationScopeOwnsWholeHost(scope: TopodMigrationSourceScope): boolean {
  return scope.kind === 'ssh-relay'
}

/** The scope as seen from one session partition. */
export function topodMigrationPartitionScope<T extends TopodMigrationSourceScope>(
  scope: T,
  partitionHostId: string
): T {
  return { ...scope, partitionHostId }
}

type TopodMigrationScopeArgs = {
  source: TopodMigrationManifestSource
  catalog: TopodMigrationCatalogPayload
  /** Detect repo IDs shared by other hosts. */
  repos: readonly Repo[]
}

/** For the SSH conversion's own steps (census, subtraction): a WSL manifest reaching them throws. */
export function createTopodMigrationSourceScope(
  args: TopodMigrationScopeArgs
): TopodMigrationSshSourceScope {
  const repoIds = new Set(args.catalog.repositories.map((repo) => repo.id))
  const source = requireTopodMigrationSshSource(args.source)
  return {
    kind: 'ssh-relay',
    targetId: source.sshTargetId,
    targetGeneration: source.sshTargetGeneration,
    hostId: toSshExecutionHostId(source.sshTargetId),
    repoIds,
    folderWorkspaceKeys: new Set(
      args.catalog.folderWorkspaces.map((workspace) => `folder:${workspace.id}`)
    ),
    sharedRepoIds: new Set(
      args.repos
        .filter(
          (repo) => repoIds.has(repo.id) && !repoBelongsToTopodSource(repo, source.sshTargetId)
        )
        .map((repo) => repo.id)
    )
  }
}

/** The scope the dormant-state export reads, for either source kind. */
export function createTopodMigrationExportScope(
  args: TopodMigrationScopeArgs
): TopodMigrationSourceScope {
  if (!isTopodMigrationLocalWslSource(args.source)) {
    return createTopodMigrationSourceScope(args)
  }
  const repoIds = new Set(args.catalog.repositories.map((repo) => repo.id))
  return {
    kind: 'local-wsl',
    targetId: null,
    targetGeneration: null,
    hostId: LOCAL_EXECUTION_HOST_ID,
    repoIds,
    folderWorkspaceKeys: new Set(
      args.catalog.folderWorkspaces.map((workspace) => `folder:${workspace.id}`)
    ),
    // Another host registering the same repo id makes its unqualified keys ambiguous.
    sharedRepoIds: new Set(
      args.repos
        .filter(
          (repo) => repoIds.has(repo.id) && getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID
        )
        .map((repo) => repo.id)
    )
  }
}

export function topodMigrationOwnsRepoId(
  scope: TopodMigrationSourceScope,
  repoId: string | null | undefined
): boolean {
  return typeof repoId === 'string' && scope.repoIds.has(repoId) && !scope.sharedRepoIds.has(repoId)
}

/** `rowHostId` is the row's own host evidence, such as worktree metadata's `hostId`. */
export function topodMigrationOwnerMatchesScope(
  value: string | null | undefined,
  scope: TopodMigrationSourceScope,
  rowHostId?: string
): boolean {
  if (!value) {
    return false
  }
  // Repeated repo IDs require host proof from a qualifier, partition or row.
  const qualified = isWorktreeHostIdentity(value)
  const ownerHost = qualified
    ? getExecutionHostIdFromWorktreeHostIdentity(value)
    : scope.partitionHostId !== undefined && scope.partitionHostId !== LOCAL_EXECUTION_HOST_ID
      ? scope.partitionHostId
      : rowHostId
  if (ownerHost !== undefined && ownerHost !== scope.hostId) {
    return false
  }
  const rawValue = qualified ? getWorktreeIdFromHostIdentity(value) : value
  if (scope.folderWorkspaceKeys.has(rawValue)) {
    return true
  }
  for (const repoId of scope.repoIds) {
    if (ownerKeyBelongsToRepo(rawValue, repoId)) {
      return ownerHost !== undefined || !scope.sharedRepoIds.has(repoId)
    }
  }
  const parsed = parseWorkspaceKey(rawValue)
  return (
    parsed?.type === 'folder' && scope.folderWorkspaceKeys.has(`folder:${parsed.folderWorkspaceId}`)
  )
}

/**
 * An unqualified key naming a moved repo that another host also registers: it may be this move's
 * row or the other host's, so a WSL move can neither carry nor ignore what it owns.
 */
export function topodMigrationOwnerKeyIsAmbiguous(
  value: string | null | undefined,
  scope: TopodMigrationSourceScope
): boolean {
  if (!value || isWorktreeHostIdentity(value)) {
    return false
  }
  return [...scope.sharedRepoIds].some(
    (repoId) => scope.repoIds.has(repoId) && ownerKeyBelongsToRepo(value, repoId)
  )
}

export function unqualifyTopodMigrationOwnerKey(value: string): string {
  return isWorktreeHostIdentity(value) ? getWorktreeIdFromHostIdentity(value) : value
}

/** Uses the child's own host stamp; a shared repo id with none might be this move's, so it counts. */
export function topodMigrationMayMoveChild(
  state: Pick<PersistedState, 'worktreeMeta'>,
  childKey: string,
  scope: TopodMigrationSourceScope
): boolean {
  const childHostId =
    state.worktreeMeta[normalizeWorkspaceSessionKeyToWorkspaceId(childKey)]?.hostId
  return (
    topodMigrationOwnerMatchesScope(childKey, scope, childHostId) ||
    (childHostId === undefined && topodMigrationOwnerKeyIsAmbiguous(childKey, scope))
  )
}
