/** Persist journal, fence, then profile flush before remote calls. Crashes may leave a non-authoritative stale journal; a fence without a journal requires destination evidence before release. */
import { randomUUID } from 'node:crypto'
import { getManagedTopodFenceEnvironmentId } from '../../../shared/managed-topod-ssh-owner'
import type { TopodMigrationBlocker } from '../../../shared/topod-migration/topod-migration-preflight'
import {
  TOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type TopodMigrationSourceCutover
} from '../../../shared/topod-migration/topod-migration-source-cutover'
import type { SshTarget } from '../../../shared/ssh-types'
import { assertTopodMigrationRequestFits } from '../../managed-server/migration/catalog/topod-migration-request-budget'
import { createTopodMigrationManifest } from '../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import {
  findTopodMigrationSourceCutoverForTarget,
  removeTopodMigrationSourceCutover,
  writeTopodMigrationSourceCutover
} from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import {
  confirmTopodMigrationTerminalsUnderFence,
  type TopodMigrationTerminalVerdict
} from './topod-migration-terminal-gate'
import type { SshTargetTopodClaims } from '../targets/ssh-target-topod-claims'
import {
  isBlockingTopodMigrationBlocker,
  preflightTopodMigrationExport,
  type TopodMigrationPreflightStore
} from '../targets/ssh-target-topod-preflight'
import { topodMigrationRefusalReason } from '../../managed-server/migration/cutover/topod-migration-refusal-reason'
import {
  preservesTopodMigrationBridgedPanes,
  type TopodMigrationPaneLeasePredicate
} from './topod-migration-bridged-panes'

export const TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS = 'topod_migration_leave_behind_terminals'
export const TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON =
  'Move anyway needs every terminal on this host closed first, and Topo could not confirm they all exited. Close them, or end them on the host, then connect again.'

export type TopodMigrationFenceState =
  | { state: 'none' }
  | { state: 'fenced'; cutover: TopodMigrationSourceCutover }
  /** Empty-host deploys record provisioning intent instead of a migration journal. */
  | { state: 'owned-by-deploy'; environmentId: string }
  /** Unexplained ownership requires recovery, never automatic release. */
  | { state: 'fenced-unverifiable'; environmentId: string }
  /** Stale journals grant no staging authority. */
  | { state: 'stale-journal'; cutover: TopodMigrationSourceCutover }

/** Throws when the journal cannot be read: an unreadable record keeps the host fenced. */
export function resolveTopodMigrationFence(
  userDataPath: string,
  target: SshTarget
): TopodMigrationFenceState {
  const cutover = findTopodMigrationSourceCutoverForTarget(userDataPath, target.id)
  const ownerEnvironmentId = getManagedTopodFenceEnvironmentId(target)
  if (cutover) {
    return ownerEnvironmentId === cutover.destinationEnvironmentId &&
      target.generation === cutover.sshTargetGeneration
      ? { state: 'fenced', cutover }
      : { state: 'stale-journal', cutover }
  }
  if (!ownerEnvironmentId) {
    return { state: 'none' }
  }
  return target.topodProvisioning
    ? { state: 'owned-by-deploy', environmentId: ownerEnvironmentId }
    : { state: 'fenced-unverifiable', environmentId: ownerEnvironmentId }
}

export type TopodMigrationFenceResult =
  | { outcome: 'fenced'; cutover: TopodMigrationSourceCutover; resumed: boolean }
  | {
      outcome: 'refused'
      verdict: 'live' | 'unverifiable'
      code: string
      reason: string
      blockers?: TopodMigrationBlocker[]
    }

export async function fenceTopodMigrationSource(args: {
  userDataPath: string
  store: TopodMigrationPreflightStore
  claims: SshTargetTopodClaims
  targetId: string
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: TopodMigrationTerminalVerdict
  isBridgedPaneLease?: TopodMigrationPaneLeasePredicate
  now?: () => Date
  signal?: AbortSignal
}): Promise<TopodMigrationFenceResult> {
  const target = args.store.getSshTarget(args.targetId)
  if (!target) {
    return refuse('unverifiable', 'topod_migration_target_not_found', 'The SSH host is gone.')
  }
  const existing = resolveTopodMigrationFence(args.userDataPath, target)
  if (existing.state === 'fenced') {
    return existing.cutover.destinationEnvironmentId === args.destinationEnvironmentId
      ? { outcome: 'fenced', cutover: existing.cutover, resumed: true }
      : refuse('live', 'topod_migration_in_progress', 'Another migration holds this SSH host.')
  }
  if (existing.state !== 'none') {
    return refuse(
      'unverifiable',
      `topod_migration_${existing.state.replaceAll('-', '_')}`,
      fenceStateReason(existing)
    )
  }
  const proof = args.terminalProof
  if (proof.verdict !== 'exited' && proof.verdict !== 'bridged') {
    return refuse(proof.verdict, 'topod_migration_terminals', proof.reason)
  }
  const preflight = preflightTopodMigrationExport(
    args.store,
    target.id,
    undefined,
    proof.verdict === 'bridged' ? proof.bridgedPtyIds : []
  )
  if (!preflight.claimable) {
    return {
      ...refuse(
        // Only a proven blocker reads live; one that is merely unanswered stays unverifiable.
        preflight.blockers
          .filter(isBlockingTopodMigrationBlocker)
          .every((blocker) => blocker.category === 'live-or-unverifiable')
          ? 'unverifiable'
          : 'live',
        'topod_migration_preflight_blocked',
        topodMigrationRefusalReason(preflight.blockers)
      ),
      blockers: preflight.blockers
    }
  }
  const generation = args.claims.ensureGeneration(target.id)
  const now = (args.now ?? (() => new Date()))().toISOString()
  const manifest = createTopodMigrationManifest(
    args.store,
    { ...target, generation },
    { migrationId: randomUUID(), destinationEnvironmentId: args.destinationEnvironmentId }
  )
  if (
    proof.verdict === 'bridged' &&
    target.managedServerLeaveBehind &&
    !preservesTopodMigrationBridgedPanes(
      manifest.payload,
      args.store.getSshRemotePtyLeases(target.id),
      proof.bridgedPtyIds,
      args.isBridgedPaneLease
    )
  ) {
    return refuse(
      proof.relayVerdict,
      TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS,
      TOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON
    )
  }
  // Reject before journaling so an unsendable manifest cannot pin the fence.
  assertTopodMigrationRequestFits({ manifest })
  const cutover: TopodMigrationSourceCutover = {
    version: TOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: manifest.migrationId,
    phase: 'source-fenced',
    startedAt: now,
    updatedAt: now,
    destinationEnvironmentId: args.destinationEnvironmentId,
    destinationName: args.destinationName,
    sshTargetId: target.id,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: proof.verdict === 'exited' ? proof.provenPtyIds : [],
    ...(proof.verdict === 'bridged' ? { bridgedPtyIds: proof.bridgedPtyIds } : {}),
    // Capture before commit; this journaled export is the evidence of what the destination receives.
    manifest
  }
  writeTopodMigrationSourceCutover(args.userDataPath, cutover)
  args.claims.fenceForMigration(target.id, args.destinationEnvironmentId, generation)
  await args.claims.flush(args.signal)
  // Recheck under fence for terminals started after the original proof.
  const underFence = confirmTopodMigrationTerminalsUnderFence(
    args.store,
    target.id,
    args.terminalProof
  )
  if (underFence.verdict !== 'exited' && underFence.verdict !== 'bridged') {
    await releaseUnstagedFence(args, cutover)
    return refuse(underFence.verdict, 'topod_migration_terminals', underFence.reason)
  }
  return { outcome: 'fenced', cutover, resumed: false }
}

type FenceReleaseArgs = { userDataPath: string; claims: SshTargetTopodClaims; signal?: AbortSignal }

async function releaseUnstagedFence(
  args: FenceReleaseArgs,
  cutover: TopodMigrationSourceCutover
): Promise<void> {
  if (cutover.phase !== 'source-fenced') {
    throw new Error('topod_migration_fence_release_after_stage')
  }
  await releaseTopodMigrationFence(args, cutover)
}

/** Drop owner before journal so an interrupted release leaves a harmless stale journal, never unexplained ownership. */
export async function releaseTopodMigrationFence(
  args: FenceReleaseArgs,
  cutover: TopodMigrationSourceCutover
): Promise<void> {
  args.claims.release(cutover.sshTargetId, cutover.destinationEnvironmentId)
  await args.claims.flush(args.signal)
  removeTopodMigrationSourceCutover(args.userDataPath, cutover.migrationId)
}

/** Unregistered destinations could stage nothing; registered destinations must prove durable abort instead. */
export async function releaseUndeployedMigrationFence(args: {
  userDataPath: string
  claims: SshTargetTopodClaims
  targetId: string
  isDestinationRegistered: (environmentId: string) => boolean
  signal?: AbortSignal
}): Promise<'released' | 'none'> {
  const cutover = findTopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  if (!cutover) {
    return 'none'
  }
  if (args.isDestinationRegistered(cutover.destinationEnvironmentId)) {
    throw new Error('topod_migration_destination_registered')
  }
  await releaseUnstagedFence(args, cutover)
  return 'released'
}

function fenceStateReason(state: TopodMigrationFenceState): string {
  switch (state.state) {
    case 'owned-by-deploy':
      return 'Topo already runs on this SSH host.'
    case 'fenced-unverifiable':
      return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s Topo server first.'
    case 'stale-journal':
      return 'A migration record names this SSH host but its fence is gone. Resolve that migration first.'
    case 'fenced':
    case 'none':
      return 'This SSH host is not in a state a migration can start from.'
  }
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<TopodMigrationFenceResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
