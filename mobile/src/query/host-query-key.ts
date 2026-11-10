import type { ExecutionHostId } from '../../../src/shared/execution-host'

// `exec` is always set: workspace ids collide across servers, as in composeWorktreeHostIdentity.
export type HostQueryTarget = { exec: ExecutionHostId; worktree?: string; repo?: string }

export type HostQueryParams = Readonly<Record<string, string | number | boolean | null>>

export type HostQueryKey = readonly [
  'topo',
  hostId: string,
  family: string,
  target: HostQueryTarget,
  params: HostQueryParams
]

export function hostQueryKey(
  hostId: string,
  family: string,
  target: HostQueryTarget,
  params: HostQueryParams
): HostQueryKey {
  return ['topo', hostId, family, target, params]
}

// Prefix of every query one paired host owns; TanStack matches keys by prefix.
export function hostScopeKey(hostId: string): readonly ['topo', string] {
  return ['topo', hostId]
}
