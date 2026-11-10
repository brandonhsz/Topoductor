import type {
  TopodMigrationClientStatePayload,
  TopodMigrationUiRoutingState
} from '../../../shared/topod-migration/topod-migration-client-state'
import type {
  TopodMigrationCatalogPayload,
  TopodMigrationManifestSource
} from '../../../shared/topod-migration/topod-migration-manifest'
import type {
  PersistedMobileClientTabSelection,
  PersistedState
} from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import { sessionPartitions } from './topod-source-workspace-session-fragments'
import { collectCloseIntents } from './topod-source-client-browser-intents'
import {
  createTopodMigrationExportScope,
  topodMigrationScopeOwnsWholeHost,
  topodMigrationOwnerMatchesScope,
  topodMigrationOwnsRepoId,
  unqualifyTopodMigrationOwnerKey
} from './topod-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session/workspace-session-pane-ownership'

export type TopodMigrationSourceClientStateInspection = {
  payload: TopodMigrationClientStatePayload | undefined
  /** Duplicate closes are folded into the existing workspace-session blocker. */
  blockedCount: number
  /** Presentation state that cannot move stays behind. */
  blockedCounts: { 'saved-port-forward': number }
}

export function collectTopodMigrationSourceClientState(
  state: PersistedState,
  source: TopodMigrationManifestSource,
  catalog: TopodMigrationCatalogPayload,
  destinationEnvironmentId: string | undefined,
  eligibleSession: WorkspaceSessionState | undefined
): TopodMigrationSourceClientStateInspection {
  const scope = createTopodMigrationExportScope({ source, catalog, repos: state.repos })
  const blockedCounts = { 'saved-port-forward': 0 }
  let blockedCount = 0
  const mobile = collectMobileSelections(state, scope, eligibleSession)
  const uiRouting = collectUiRouting(state, scope, eligibleSession)
  const target = state.sshTargets.find((entry) => entry.id === scope.targetId)
  const savedPortForwards = target?.portForwards ? structuredClone(target.portForwards) : undefined
  if (savedPortForwards) {
    const ports = new Set<number>()
    for (const forward of savedPortForwards) {
      if (ports.has(forward.localPort)) {
        blockedCounts['saved-port-forward'] += 1
      }
      ports.add(forward.localPort)
    }
  }
  const closeIntents = collectCloseIntents(
    state,
    scope,
    destinationEnvironmentId,
    eligibleSession,
    () => {
      blockedCount += 1
    }
  )
  const clientState: TopodMigrationClientStatePayload = {
    ...(mobile && Object.keys(mobile).length > 0
      ? { mobileClientTabSelectionsByDeviceId: mobile }
      : {}),
    ...(uiRouting && Object.keys(uiRouting).length > 0 ? { uiRouting } : {}),
    ...(savedPortForwards && savedPortForwards.length > 0 ? { savedPortForwards } : {}),
    ...(closeIntents && closeIntents.length > 0
      ? { clientHostedBrowserCloseIntents: closeIntents }
      : {})
  }
  return {
    payload: Object.keys(clientState).length > 0 ? clientState : undefined,
    blockedCount,
    blockedCounts
  }
}

function collectMobileSelections(
  state: PersistedState,
  scope: ReturnType<typeof createTopodMigrationExportScope>,
  session: WorkspaceSessionState | undefined
):
  | NonNullable<TopodMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']>
  | undefined {
  const eligible = session ? collectEligibleSessionIdentity(session, scope) : null
  const result: NonNullable<
    TopodMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  > = {}
  const destinationKeys = new Set<string>()
  for (const [deviceId, selections] of Object.entries(
    state.mobileClientTabSelectionsByDeviceId ?? {}
  )) {
    const projected: Record<string, PersistedMobileClientTabSelection> = {}
    for (const [ownerKey, selection] of Object.entries(selections)) {
      if (!topodMigrationOwnerMatchesScope(ownerKey, scope)) {
        continue
      }
      const destinationKey = unqualifyTopodMigrationOwnerKey(ownerKey)
      const representable = representableMobileSelection(selection, eligible)
      if (!representable || destinationKeys.has(`${deviceId}\0${destinationKey}`)) {
        continue
      }
      destinationKeys.add(`${deviceId}\0${destinationKey}`)
      projected[destinationKey] = representable
    }
    if (Object.keys(projected).length > 0) {
      result[deviceId] = projected
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function collectUiRouting(
  state: PersistedState,
  scope: ReturnType<typeof createTopodMigrationExportScope>,
  session: WorkspaceSessionState | undefined
): TopodMigrationUiRoutingState | undefined {
  const ui = state.ui
  const result: TopodMigrationUiRoutingState = {}
  if (ui.lastActiveRepoId && topodMigrationOwnsRepoId(scope, ui.lastActiveRepoId)) {
    result.lastActiveRepoId = ui.lastActiveRepoId
  }
  if (ui.lastActiveWorktreeId && topodMigrationOwnerMatchesScope(ui.lastActiveWorktreeId, scope)) {
    result.lastActiveWorktreeId = unqualifyTopodMigrationOwnerKey(ui.lastActiveWorktreeId)
  }
  const dotfiles = Object.entries(ui.showDotfilesByWorktree ?? {})
    .filter(([ownerKey]) => topodMigrationOwnerMatchesScope(ownerKey, scope))
    .map(([ownerKey, enabled]) => [unqualifyTopodMigrationOwnerKey(ownerKey), enabled] as const)
  if (dotfiles.length > 0) {
    result.showDotfilesByWorktree = Object.fromEntries(dotfiles)
  }
  const dismissed = (ui.setupScriptPromptDismissedRepoIds ?? []).filter((repoId) =>
    topodMigrationOwnsRepoId(scope, repoId)
  )
  if (dismissed.length > 0) {
    result.setupScriptPromptDismissedRepoIds = dismissed
  }
  const manualOrder = (ui.manualRepoOrder ?? [])
    .filter((entry) => entry.hostId === scope.hostId && scope.repoIds.has(entry.repoId))
    .map((entry) => ({ hostId: 'local' as const, repoId: entry.repoId }))
  if (manualOrder.length > 0) {
    result.manualRepoOrder = manualOrder
  }
  // Sidebar filters belong to this desktop's window.
  const eligible = session ? collectEligibleSessionIdentity(session, scope) : null
  const sourceTabIds = collectSourceOwnedTabIds(state, scope)
  const acknowledgements = Object.entries(ui.acknowledgedAgentsByPaneKey ?? {}).filter(
    ([paneKey]) => {
      return (
        paneBelongsToTabs(paneKey, sourceTabIds) &&
        eligible !== null &&
        paneBelongsToTabs(paneKey, eligible.tabIds)
      )
    }
  )
  if (acknowledgements.length > 0) {
    result.acknowledgedAgentsByPaneKey = Object.fromEntries(acknowledgements)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Include source-owned tabs from every partition. */
function collectSourceOwnedTabIds(
  state: PersistedState,
  scope: ReturnType<typeof createTopodMigrationExportScope>
): Set<string> {
  const tabIds = new Set<string>()
  for (const [hostId, session] of sessionPartitions(state, 'local')) {
    for (const [ownerKey, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
      if (
        (topodMigrationScopeOwnsWholeHost(scope) && hostId === scope.hostId) ||
        topodMigrationOwnerMatchesScope(ownerKey, scope)
      ) {
        tabs.forEach((tab) => tabIds.add(tab.id))
      }
    }
  }
  return tabIds
}

type EligibleSessionIdentity = { tabIds: ReadonlySet<string>; groupIds: ReadonlySet<string> }

function collectEligibleSessionIdentity(
  session: WorkspaceSessionState,
  scope: ReturnType<typeof createTopodMigrationExportScope>
): EligibleSessionIdentity {
  const tabIds = new Set<string>()
  const groupIds = new Set<string>()
  for (const [ownerKey, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
    if (!topodMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    tabs.forEach((tab) => tabIds.add(tab.id))
  }
  for (const [ownerKey, tabs] of Object.entries(session.unifiedTabs ?? {})) {
    if (topodMigrationOwnerMatchesScope(ownerKey, scope)) {
      tabs.forEach((tab) => tabIds.add(tab.id))
    }
  }
  for (const [ownerKey, groups] of Object.entries(session.tabGroups ?? {})) {
    if (!topodMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    groups.forEach((group) => groupIds.add(group.id))
  }
  return { tabIds, groupIds }
}

/** Mobile terminal selections name panes: tabId::leafId. */
function movedMobileTab(id: string, tabIds: ReadonlySet<string>): boolean {
  const separator = id.indexOf('::')
  return tabIds.has(id) || (separator !== -1 && tabIds.has(id.slice(0, separator)))
}

/** Drop references to tabs/groups that did not move; null when none remain. */
function representableMobileSelection(
  selection: PersistedMobileClientTabSelection,
  eligible: EligibleSessionIdentity | null
): PersistedMobileClientTabSelection | null {
  const tabIds = eligible?.tabIds ?? new Set<string>()
  const groupIds = eligible?.groupIds ?? new Set<string>()
  const recentTabIds = selection.recentTabIds?.filter((tabId) => tabIds.has(tabId)) ?? []
  const next: PersistedMobileClientTabSelection = {
    activeTabId:
      selection.activeTabId !== null && movedMobileTab(selection.activeTabId, tabIds)
        ? selection.activeTabId
        : null,
    activeGroupId:
      selection.activeGroupId !== null && groupIds.has(selection.activeGroupId)
        ? selection.activeGroupId
        : null,
    activeTabIdByGroupId: Object.fromEntries(
      Object.entries(selection.activeTabIdByGroupId).filter(
        ([groupId, tabId]) => groupIds.has(groupId) && tabIds.has(tabId)
      )
    ),
    ...(recentTabIds.length > 0 ? { recentTabIds } : {})
  }
  return next.activeTabId === null &&
    next.activeGroupId === null &&
    Object.keys(next.activeTabIdByGroupId).length === 0
    ? null
    : next
}
