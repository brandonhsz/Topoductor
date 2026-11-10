import { getAutomationRunRepoId } from '../../../shared/automations/history/automation-run-identity'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { createTopodMigrationSourceScope, topodMigrationOwnsRepoId } from './topod-source-scope'

/** Include rows a downgraded build added to moved projects. */
export function subtractTopodMigrationSourceAutomationState(
  state: PersistedState,
  manifest: TopodMigrationManifest
): void {
  const scope = createTopodMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const automationIds = new Set([
    ...(manifest.payload.dormantState?.automations ?? []).map((entry) => entry.id),
    ...state.automations
      .filter(
        (entry) =>
          topodMigrationOwnsRepoId(scope, getAutomationRunRepoId(entry)) &&
          (entry.executionTargetType !== 'ssh' || entry.executionTargetId === scope.targetId)
      )
      .map((entry) => entry.id)
  ])
  const runIds = new Set((manifest.payload.dormantState?.automationRuns ?? []).map((run) => run.id))
  state.automations = state.automations.filter((entry) => !automationIds.has(entry.id))
  state.automationRuns = state.automationRuns.filter(
    (run) => !runIds.has(run.id) && !automationIds.has(run.automationId)
  )
}
