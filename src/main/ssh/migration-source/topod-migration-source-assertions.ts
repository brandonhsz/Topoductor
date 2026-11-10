import { createHash } from 'node:crypto'
import {
  serializeTopodMigrationValue,
  type TopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest'
import type { TopodMigrationSourceCutover } from '../../../shared/topod-migration/topod-migration-source-cutover'
import {
  exportTopodMigrationManifest,
  type TopodMigrationExportedBlob
} from '../../persistence/migrating-topod-catalog/topod-migration-manifest-export'
import { resolveTopodMigrationFence } from './topod-migration-source-fence'
import { confirmTopodMigrationTerminalsUnderFence } from './topod-migration-terminal-gate'
import { collectUntransferredDependentBlockers } from '../targets/ssh-target-topod-dependents'
import type { TopodMigrationPreflightStore } from '../targets/ssh-target-topod-preflight'

/** Returns the re-read bytes of the blobs the journaled manifest names; unchanged source proves them. */
export function assertTopodMigrationSourceUnchanged(
  context: { userDataPath: string; store: TopodMigrationPreflightStore },
  cutover: TopodMigrationSourceCutover
): TopodMigrationExportedBlob[] {
  const target = context.store.getSshTarget(cutover.sshTargetId)
  const fence = target ? resolveTopodMigrationFence(context.userDataPath, target) : null
  if (!target || fence?.state !== 'fenced' || fence.cutover.migrationId !== cutover.migrationId) {
    throw new Error('topod_migration_source_fence_lost')
  }
  // Re-export with journaled identity/time/destination so only source changes affect comparison.
  const { manifest: current, blobs } = exportTopodMigrationManifest(context.store, target, {
    migrationId: cutover.migrationId,
    destinationEnvironmentId: cutover.destinationEnvironmentId,
    now: () => new Date(cutover.manifest.createdAt),
    inlineAutomationRuns: cutover.manifest.payload.dormantState?.automationRuns !== undefined
  })
  if (frozenSourceDigest(current) !== frozenSourceDigest(cutover.manifest)) {
    throw new Error('topod_migration_source_changed')
  }
  if (collectUntransferredDependentBlockers(context.store, cutover.manifest).length > 0) {
    throw new Error('topod_migration_source_dependencies_present')
  }
  const terminals = confirmTopodMigrationTerminalsUnderFence(
    context.store,
    target.id,
    cutover.bridgedPtyIds
      ? {
          verdict: 'bridged',
          relayVerdict: 'unverifiable',
          bridgedPtyIds: cutover.bridgedPtyIds,
          hostTerminals: 0
        }
      : { verdict: 'exited', provenPtyIds: cutover.provenPtyIds }
  )
  if (terminals.verdict === 'live' || terminals.verdict === 'unverifiable') {
    throw new Error(`topod_migration_source_terminals_${terminals.verdict}`)
  }
  return blobs
}

/** Ignore mutable UI layout/focus/routing: the destination gets the journaled view, and tab churn must not invalidate migration. */
function frozenSourceDigest(manifest: TopodMigrationManifest): string {
  const { manifestSha256: _digest, payload, ...rest } = manifest
  const {
    version: _version,
    workspaceSession: _session,
    clientState: _client,
    // Retention preserves journaled bytes even if their tab closes during transfer.
    terminalScrollbackSnapshots: _snapshots,
    ...dormant
  } = payload.dormantState ?? {}
  // UI-only changes can introduce a dormant payload that export previously omitted as empty.
  const empty = Object.values(dormant).every(
    (value) => value === undefined || (Array.isArray(value) && value.length === 0)
  )
  const frozen = { ...rest, payload: { ...payload, dormantState: empty ? undefined : dormant } }
  return createHash('sha256').update(serializeTopodMigrationValue(frozen)).digest('hex')
}
