/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  TOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type TopodMigrationSourceCutover
} from '../../../../shared/topod-migration/topod-migration-source-cutover'
import type { TopodDeltaMoveResult } from '../../../../shared/topod-managed-runtime'
import { recordManagedTopodMigration } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { Store } from '../../../persistence/loading-store/store'
import {
  abortTopodMigrationCutover,
  commitTopodMigrationDestination,
  type TopodMigrationCutoverContext,
  type TopodMigrationDestinationCatalog
} from './topod-migration-cutover-coordinator'
import {
  findTopodMigrationSourceCutoverForTarget,
  listTopodMigrationCutoverChainForTarget,
  removeTopodMigrationSourceCutover,
  writeTopodMigrationSourceCutover
} from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  committedTopodMigrationChain,
  topodDeltaSourceStore,
  planTopodDeltaMove,
  unfinishedTopodDelta,
  type TopodDeltaMovePlan
} from './topod-migration-delta-plan'
import { assertTopodMigrationRequestFits } from '../catalog/topod-migration-request-budget'
import { retainTopodMigrationSource } from '../../../persistence/migrating-topod-catalog/topod-migration-source-retention'
import {
  assessTopodMigrationTerminals,
  type TopodMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from '../../../ssh/migration-source/topod-migration-terminal-gate'
import {
  currentTopodSourceFingerprint,
  topodCatalogFingerprint,
  unmovedTopodSourceRows,
  withKeptTopodSourceRows
} from '../../../persistence/migrating-topod-catalog/topod-retained-source'
import { collectTopodMigrationSourceCatalog } from '../../../persistence/migrating-topod-catalog/topod-source-catalog'
import type { SshTargetTopodClaims } from '../../../ssh/targets/ssh-target-topod-claims'
import { topodMigrationRefusalReason } from './topod-migration-refusal-reason'
import { errorMessage } from '../../../../shared/error-message'

type TopodDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetTopodClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<TopodMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runTopodDeltaMove(args: TopodDeltaMoveArgs): Promise<TopodDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planTopodDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentTopodSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('topod_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('topod_migration_preflight_blocked', topodMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertTopodMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessTopodMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('topod_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.topodFence?.sourceChangedAt
    const head = findTopodMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('topod_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentTopodSourceFingerprint(store, target)) {
      return refuse(
        'topod_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<TopodMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: TopodDeltaMoveArgs,
  plan: TopodDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): TopodMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: TopodMigrationSourceCutover = {
    version: TOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeTopodMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: TopodDeltaMoveArgs,
  plan: TopodDeltaMovePlan,
  cutover: TopodMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<TopodDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { topodFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  recordManagedTopodMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: TopodMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: TopodMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => topodDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitTopodMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`topod_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('topod_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainTopodMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: TopodDeltaMoveArgs,
  context: TopodMigrationCutoverContext,
  cutover: TopodMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortTopodMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeTopodMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<TopodDeltaMoveArgs, 'store' | 'claims'>,
  cutover: TopodMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    topodFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepTopodServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetTopodClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.topodFence?.environmentId
  const chain = listTopodMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedTopodDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('topod_delta_move_unfinished')
  }
  const head = committedTopodMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.topodFence?.sourceChangedAt || !head) {
    throw new Error('topod_delta_not_changed')
  }
  const current = collectTopodMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedTopodSourceRows(current, committedTopodMigrationChain(chain))
  writeTopodMigrationSourceCutover(args.userDataPath, {
    ...withKeptTopodSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: topodCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { topodFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<TopodDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
