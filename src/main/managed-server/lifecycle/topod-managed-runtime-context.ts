import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { TOPOD_UPDATE_TERMINALS_RUNNING_CODE } from '../../../shared/topod-managed-runtime'
import {
  getTopodSshDeployment,
  type KnownRuntimeEnvironment,
  type TopodSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { getManagedTopodFenceEnvironmentId } from '../../../shared/managed-topod-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalTopodBuildHash } from '../install/topod-local-build-hash'

import type { TopodHostTarget } from '../install/topod-host-transport'
import type { TopodActivationRecord } from '../activation/topod-activation-record'
import { admitTopodRecordForIntent, type TopodUpdateIntent } from './topod-managed-update-decision'
import {
  type TopodTerminalCensus,
  UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
} from '../../../shared/topod-terminal-census'
import { probeActiveTopodReadiness } from '../activation/topod-active-readiness'
import { resolveTopodRemoteContext, type TopodRemoteContext } from '../install/topod-remote-context'
import { TOPOD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const TOPOD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_TOPOD_LEGACY_NODE_PATH = ''

export function requireManagedTopodInfrastructure() {
  const targetStore = requireManagedTopodTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Topo server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getTopodRuntimeClaims() }
}

export function requireManagedTopodTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s Topo server is unverifiable.')
  }
  return targetStore
}

export function requireManagedTopodEnvironment(
  userDataPath: string,
  selector: string
): { environment: KnownRuntimeEnvironment; deployment: TopodSshDeploymentLink } {
  const environment = resolveEnvironment(userDataPath, selector)
  const deployment = getTopodSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an topod SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedTopodContext(
  environment: KnownRuntimeEnvironment,
  deployment: TopodSshDeploymentLink,
  signal?: AbortSignal
): Promise<TopodRemoteContext> {
  const { connectionManager, targetStore } = requireManagedTopodInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedTopodFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s Topo server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveTopodRemoteContext(target, connection, signal)
}

export function managedTopodSlot(
  context: TopodRemoteContext<TopodHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_TOPOD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: TOPOD_BIND_HOST,
    port,
    signal
  }
}

export function managedTopodInstallDir(
  context: TopodRemoteContext<TopodHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    TOPOD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedTopodReadiness(
  context: TopodRemoteContext<TopodHostTarget>,
  localTopodDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveTopodReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedTopodInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalTopodBuildHash(localTopodDir), fullVersion }
  )
}

export function managedTopodDeployPolicy(
  context: Pick<TopodRemoteContext<TopodHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: TopodUpdateIntent
): {
  census: TopodTerminalCensus
  recountCensus: () => Promise<TopodTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: TopodActivationRecord
  admitRecord: (record: TopodActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: TopodTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: admitTopodRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, never unknown census or protocol deferrals.
export function isForceableTopodDeferral(code: string): boolean {
  return code === TOPOD_UPDATE_TERMINALS_RUNNING_CODE
}
