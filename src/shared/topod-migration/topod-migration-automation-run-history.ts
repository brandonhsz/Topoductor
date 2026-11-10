/** Finished automation runs travel as one blob; the signed manifest carries only its digest, so run
 * history never bounds the manifest. Format changes require a new capability. */
import type { AutomationRun } from '../automations/history/automation-run'
import type { TopodMigrationBlobDescriptor } from './topod-migration-blob-transfer'
import {
  serializeTopodMigrationValue,
  type TopodMigrationAutomationRunHistoryRef,
  type TopodMigrationManifest
} from './topod-migration-manifest'
import { parseTopodMigrationCatalogPayload } from './topod-migration-manifest-validation'
import { requiredRecord } from './topod-migration-dormant-value-validation'

const TOPOD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION = 1

/** Canonical, so a re-export of an unchanged source reproduces the journaled digest. */
export function serializeTopodMigrationAutomationRunHistory(
  runs: readonly AutomationRun[]
): string {
  return serializeTopodMigrationValue({
    version: TOPOD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION,
    runs
  })
}

export function topodMigrationAutomationRunHistoryBlob(
  ref: TopodMigrationAutomationRunHistoryRef
): TopodMigrationBlobDescriptor {
  return { blobKind: 'automation-run-history', key: 'migration', ...ref }
}

/** Blobs the manifest itself names; its commit is refused until they are staged. */
export function topodMigrationManifestBlobs(
  manifest: Pick<TopodMigrationManifest, 'payload'>
): TopodMigrationBlobDescriptor[] {
  const ref = manifest.payload.dormantState?.automationRunHistory
  return ref ? [topodMigrationAutomationRunHistoryBlob(ref)] : []
}

/** The manifest with its runs inline, validated against its own catalog as inline runs would be. */
export function withTopodMigrationAutomationRunHistory<
  T extends Pick<TopodMigrationManifest, 'payload'>
>(manifest: T, text: string): T {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    throw new Error('topod_migration_automation_run_history_invalid')
  }
  const record = requiredRecord(document, 'topod_migration_automation_run_history_invalid')
  if (record.version !== TOPOD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION) {
    throw new Error('topod_migration_automation_run_history_version_unsupported')
  }
  const { automationRunHistory: _ref, ...dormantState } = manifest.payload.dormantState ?? {}
  return {
    ...manifest,
    payload: parseTopodMigrationCatalogPayload({
      ...manifest.payload,
      dormantState: { ...dormantState, automationRuns: record.runs }
    })
  }
}
