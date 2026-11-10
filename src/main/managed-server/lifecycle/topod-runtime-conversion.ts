// Resume journaled migrations after lost contact; source rows stay authoritative until proven commit.
// Retain source rows afterwards for downgrade compatibility.
import { randomUUID } from 'node:crypto'
import type { TopodManagedConversionResult } from '../../../shared/topod-managed-runtime'
import type { TopodMigrationSourceCutover } from '../../../shared/topod-migration/topod-migration-source-cutover'
import { recordManagedTopodMigration } from '../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  getTopodSshDeployment,
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { environmentMatchesManagedTopodCutover } from './topod-managed-migration-status'
import { requireManagedTopodInfrastructure } from './topod-managed-runtime-context'
import { ensureTopodManagedTunnel } from './topod-managed-tunnel'
import {
  commitTopodMigrationDestination,
  type TopodMigrationDestinationCatalog
} from '../migration/cutover/topod-migration-cutover-coordinator'
import {
  findTopodMigrationSourceCutoverForTarget,
  removeTopodMigrationJournalsForDestination
} from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import type { SshTarget } from '../../../shared/ssh-types'
import type { CensusHostRelayTerminals } from '../../ssh/migration-source/topod-migration-terminal-gate'
import { createManagedTopodEnvironment } from './topod-runtime-deployment'
import { createSshRelayMigrationSource } from '../../ssh/migration-source/topod-migration-ssh-relay-source'
import {
  leaveBehindClearsTopodMigrationBlockers,
  onlyLeavableTopodMigrationBlockers
} from '../../ssh/targets/ssh-target-topod-preflight'
import { TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON } from '../../ssh/migration-source/topod-migration-source-fence'
import type { TopodMigrationPaneLeasePredicate } from '../../ssh/migration-source/topod-migration-bridged-panes'
import { retainTopodMigrationSource } from '../../persistence/migrating-topod-catalog/topod-migration-source-retention'
import {
  enableMovedTopodAutomations,
  type EnableServerAutomation
} from '../../persistence/migrating-topod-catalog/topod-migration-moved-automations'
import {
  linkedTopodMigrationCutoverPort,
  linkedTopodMigrationProjects,
  linkServerHeldRepositories
} from '../migration/linking/topod-migration-repository-link'
import type { TopodServerRepository } from '../migration/linking/topod-server-repositories'
import type { TopodServerFolderCatalog } from '../migration/linking/topod-server-folder-workspaces'

export type TopodManagedConversionArgs = {
  sshTargetId: string
  name: string
  censusHost?: ((target: SshTarget) => ReturnType<CensusHostRelayTerminals>) | null
  isBridgedPaneLease?: TopodMigrationPaneLeasePredicate
  destinationFor: (environment: KnownRuntimeEnvironment) => TopodMigrationDestinationCatalog
  /** Link matching host paths to existing server projects. */
  serverRepositoriesFor?: (environment: KnownRuntimeEnvironment) => Promise<TopodServerRepository[]>
  /** Link folder workspaces already present from earlier moves. */
  serverFolderCatalogFor?: (
    environment: KnownRuntimeEnvironment
  ) => Promise<TopodServerFolderCatalog>
  releaseDirectSession?: (sshTargetId: string) => Promise<void>
  /** Re-enables moved automations that ran on this desktop. */
  serverAutomationEnablerFor?: (environment: KnownRuntimeEnvironment) => EnableServerAutomation
  now?: () => Date
  signal?: AbortSignal
}

export async function convertSshTargetToManagedTopod(
  userDataPath: string,
  args: TopodManagedConversionArgs
): Promise<TopodManagedConversionResult> {
  const fenced = await fenceOrResume(userDataPath, args)
  if ('outcome' in fenced) {
    return fenced
  }
  const deployed = await createManagedTopodEnvironment(userDataPath, {
    name: fenced.destinationName,
    sshTargetId: fenced.sshTargetId,
    migration: true,
    signal: args.signal
  })
  if (deployed.outcome === 'deferred') {
    return deployed // Retain fence and journal for a later resume.
  }
  const environment = listEnvironments(userDataPath).find(
    (entry) => entry.id === fenced.destinationEnvironmentId
  )
  if (!environment || !environmentMatchesManagedTopodCutover(environment, fenced)) {
    throw new Error('topod_migration_destination_environment_mismatch')
  }
  // Record before commit so crashes cannot allow rollback across migrated state.
  recordManagedTopodMigration(
    userDataPath,
    environment.id,
    (args.now ?? (() => new Date()))().toISOString()
  )
  // Tunnel repair may replace pairing credentials; use its returned environment for every request.
  const marked = await ensureTopodManagedTunnel(userDataPath, environment.id)
  const { claims, targetStore } = requireManagedTopodInfrastructure()
  const store = targetStore.getTopodMigrationSource()
  const destination = args.destinationFor(marked)
  const serverRepositoriesFor = args.serverRepositoriesFor
  const serverFolderCatalogFor = args.serverFolderCatalogFor
  let linked: Pick<
    TopodMigrationSourceCutover,
    'linkedRepositoryIds' | 'linkedFolderWorkspaceIds'
  > = {}
  const committed = await runTargetLifecycle(fenced.sshTargetId, async () => {
    const journaled = requireJournaledCutover(userDataPath, fenced)
    const cutover = serverRepositoriesFor
      ? await linkServerHeldRepositories({
          userDataPath,
          store,
          claims,
          cutover: journaled,
          destination,
          serverRepositories: () => serverRepositoriesFor(marked),
          ...(serverFolderCatalogFor
            ? { serverFolderCatalog: () => serverFolderCatalogFor(marked) }
            : {}),
          now: args.now
        })
      : journaled
    linked = cutover
    return commitTopodMigrationDestination(
      {
        userDataPath,
        store,
        claims,
        source: linkedTopodMigrationCutoverPort({ userDataPath, store, claims, cutover }),
        destination,
        now: args.now
      },
      cutover.migrationId
    )
  })
  if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
    throw new Error(`topod_migration_commit_not_proven:${committed.phase}`)
  }
  let automationsLeftDisabled = 0
  if (committed.phase === 'destination-committed') {
    await retainTopodMigrationSource(userDataPath, committed.migrationId, store, args.now)
    if (args.serverAutomationEnablerFor) {
      automationsLeftDisabled = await enableMovedTopodAutomations(
        userDataPath,
        committed.migrationId,
        args.serverAutomationEnablerFor(marked)
      ).catch((error: unknown) => {
        console.warn('[ssh] Could not re-enable moved automations:', error)
        return 0
      })
    }
  }
  const linkedProjects = linkedTopodMigrationProjects(store, linked)
  return {
    outcome: 'converted',
    environment: redactRuntimeEnvironment(marked),
    migrationId: committed.migrationId,
    ...(linkedProjects.length > 0 ? { linkedProjects } : {}),
    ...(automationsLeftDisabled > 0 ? { automationsLeftDisabled } : {})
  }
}

async function fenceOrResume(
  userDataPath: string,
  args: TopodManagedConversionArgs
): Promise<
  TopodMigrationSourceCutover | Extract<TopodManagedConversionResult, { outcome: 'refused' }>
> {
  const { claims, targetStore } = requireManagedTopodInfrastructure()
  const target = targetStore.getTarget(args.sshTargetId)
  if (!target) {
    return refuse('unverifiable', 'topod_migration_target_not_found', 'The SSH host is gone.')
  }
  const store = targetStore.getTopodMigrationSource()
  const censusHost = args.censusHost
  const source = createSshRelayMigrationSource({
    userDataPath,
    store,
    claims,
    target,
    censusHost: censusHost ? () => censusHost(target) : null,
    isBridgedPaneLease: args.isBridgedPaneLease
  })
  const existing = source.resolveFence()
  if (existing.state === 'fenced') {
    return existing.cutover
  }
  const stale = existing.state === 'stale-journal' ? existing.cutover : null
  if (stale && !isRegistered(userDataPath, stale.destinationEnvironmentId)) {
    removeTopodMigrationJournalsForDestination(
      userDataPath,
      target.id,
      stale.destinationEnvironmentId
    )
  }
  const converted = listEnvironments(userDataPath).some(
    (environment) => getTopodSshDeployment(environment)?.sshTargetId === target.id
  )
  if (converted) {
    return refuse('live', 'topod_migration_already_managed', 'Topo already runs on this SSH host.')
  }
  // Source fencing rechecks leases after acquisition.
  const terminalProof = await source.assessTerminals()
  if (terminalProof.verdict === 'live' || terminalProof.verdict === 'unverifiable') {
    return refuse(terminalProof.verdict, 'topod_migration_terminals', terminalProof.reason)
  }
  source.retireProvenExitedTerminals(terminalProof)
  await args.releaseDirectSession?.(target.id)
  const result = await runTargetLifecycle(target.id, () =>
    source.acquireFence({
      destinationEnvironmentId: randomUUID(),
      destinationName: args.name,
      terminalProof,
      now: args.now,
      signal: args.signal
    })
  )
  if (result.outcome === 'fenced') {
    return result.cutover
  }
  if (result.blockers?.length) {
    // Surface blocked state in logs because connect shows only the summary reason.
    console.warn(
      '[ssh] Conversion refused by:',
      JSON.stringify(
        result.blockers.map((blocker) =>
          'dependencies' in blocker
            ? { code: blocker.code, dependencies: blocker.dependencies }
            : { code: blocker.code }
        )
      )
    )
  }
  const leavable =
    result.blockers &&
    onlyLeavableTopodMigrationBlockers(result.blockers) &&
    !target.managedServerLeaveBehind
  const canLeaveBehind =
    leavable &&
    leaveBehindClearsTopodMigrationBlockers(
      store,
      target.id,
      terminalProof.verdict === 'bridged' ? terminalProof.bridgedPtyIds : [],
      args.isBridgedPaneLease
    )
  if (leavable && terminalProof.verdict !== 'exited' && !canLeaveBehind) {
    // Leaving tabs behind would strand terminals still served by the legacy bridge.
    return refuse(
      result.verdict,
      result.code,
      `${result.reason} ${TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON}`
    )
  }
  return {
    ...refuse(result.verdict, result.code, result.reason),
    // Preview confirmation to avoid offering an export the confirmed path would refuse.
    ...(canLeaveBehind ? { canLeaveBehind: true } : {})
  }
}

function requireJournaledCutover(
  userDataPath: string,
  fenced: TopodMigrationSourceCutover
): TopodMigrationSourceCutover {
  const journaled = findTopodMigrationSourceCutoverForTarget(userDataPath, fenced.sshTargetId)
  if (journaled?.migrationId !== fenced.migrationId) {
    throw new Error('topod_migration_source_fence_lost')
  }
  return journaled
}

function isRegistered(userDataPath: string, environmentId: string): boolean {
  return listEnvironments(userDataPath).some((environment) => environment.id === environmentId)
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<TopodManagedConversionResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
