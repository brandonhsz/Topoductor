import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import {
  TOPOD_MIGRATION_DEPENDENCY_KINDS,
  type TopodMigrationDependencyKind
} from '../../../shared/topod-migration/topod-migration-preflight'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../pty/scrollback/terminal-scrollback-snapshots'
import {
  inspectTopodMigrationSourceSessions,
  type TopodMigrationSourceSessionInspection
} from './topod-source-session-dependencies'
import {
  collectTopodMigrationSourceDormantState,
  topodMigrationLeavesBehind
} from './topod-source-dormant-state'
import {
  createTopodMigrationSourceScope,
  topodMigrationOwnerMatchesScope,
  topodMigrationPartitionScope,
  type TopodMigrationSourceScope
} from './topod-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session/workspace-session-pane-ownership'

export type TopodMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<TopodMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<TopodMigrationDependencyKind, string[]>>
}

export function collectTopodMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: TopodMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): TopodMigrationSourceDependencyCensus {
  const scope = createTopodMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectTopodMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      topodMigrationOwnerMatchesScope(
        ownerKey,
        topodMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectTopodMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<TopodMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': topodMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: TOPOD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names: {
      ...(dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}),
      ...(dormant.runningAutomationItems.length > 0
        ? { 'automation-run': dormant.runningAutomationItems }
        : {})
    }
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: TopodMigrationSourceScope,
  sessions: TopodMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      topodMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
