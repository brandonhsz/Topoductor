import type { PersistedTrustedTopoHooks } from '../../../src/shared/topo-yaml-hook-types'
import {
  canUseRepoWideTrust,
  type TopoHookTrustKind,
  withTopoHookRepoAlwaysTrusted,
  withTopoHookScriptConfirmed
} from '../../../src/shared/topo-hook-trust-entries'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { taskUiStateWrite } from './mobile-task-runtime-operations'

export type SetupHookTrust = {
  contentHash: string
  scriptContent: string
}

export function isTopoHookTrusted(
  trust: PersistedTrustedTopoHooks,
  repos: readonly { id: string }[],
  repoId: string,
  kind: TopoHookTrustKind,
  contentHash: string
): boolean {
  return (
    canUseRepoWideTrust(trust, repos, repoId) || trust[repoId]?.[kind]?.contentHash === contentHash
  )
}

export function isSetupHookTrusted(
  trust: PersistedTrustedTopoHooks,
  repos: readonly { id: string }[],
  repoId: string,
  contentHash: string
): boolean {
  return isTopoHookTrusted(trust, repos, repoId, 'setup', contentHash)
}

export function wasTopoHookPreviouslyApproved(
  trust: PersistedTrustedTopoHooks,
  repoId: string,
  kind: TopoHookTrustKind
): boolean {
  return Boolean(trust[repoId]?.[kind]?.contentHash)
}

export function wasSetupHookPreviouslyApproved(
  trust: PersistedTrustedTopoHooks,
  repoId: string
): boolean {
  return wasTopoHookPreviouslyApproved(trust, repoId, 'setup')
}

type HookTrustApproval = {
  client: RpcClient
  trust: PersistedTrustedTopoHooks
  repoId: string
  contentHash: string
  alwaysTrust: boolean
}

export async function persistTopoHookTrustApproval(
  args: HookTrustApproval & { kind: TopoHookTrustKind }
): Promise<PersistedTrustedTopoHooks> {
  // Repo-wide trust is ignored when the repo id is on two hosts, so keep this script's approval too.
  const confirmed = withTopoHookScriptConfirmed(
    args.trust,
    args.repoId,
    args.kind,
    args.contentHash
  )
  const next = args.alwaysTrust ? withTopoHookRepoAlwaysTrusted(confirmed, args.repoId) : confirmed
  taskUiStateWrite.interpret(
    await taskUiStateWrite.request(args.client, { trustedTopoHooks: next })
  )
  return next
}

export function persistSetupHookTrustApproval(
  args: HookTrustApproval
): Promise<PersistedTrustedTopoHooks> {
  return persistTopoHookTrustApproval({ ...args, kind: 'setup' })
}

// Hooks may omit setupTrust; validate the pair here while preserving other host fields.
export function normalizeSetupHookTrust(
  setupTrust: { contentHash?: string; scriptContent?: string } | null | undefined
): SetupHookTrust | null {
  const contentHash = setupTrust?.contentHash
  const scriptContent = setupTrust?.scriptContent
  if (!contentHash || !scriptContent) {
    return null
  }
  return { ...setupTrust, contentHash, scriptContent }
}

// New hosts send setupConfig (topo.yaml setup plus defaultTabs commands); older ones only the effective setup script.
export function readRepoHooksSetupCommand(reply: {
  hooks?: { scripts?: { setup?: string } } | null
  setupConfig?: { command: string } | null
}): string | null {
  if (reply.setupConfig !== undefined) {
    return reply.setupConfig?.command.trim() || null
  }
  return reply.hooks?.scripts?.setup?.trim() || null
}
