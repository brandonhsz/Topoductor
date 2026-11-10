import {
  topodMigrationAutomationRunHistoryBlob,
  withTopodMigrationAutomationRunHistory
} from '../../../shared/topod-migration/topod-migration-automation-run-history'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import { readTopodMigrationBlob } from './topod-migration-blob-staging'

/** The manifest signs the history's digest, so its rows import with the catalog or not at all. */
export function withStagedAutomationRunHistory(
  manifest: TopodMigrationManifest,
  blobRoot: string
): TopodMigrationManifest {
  const ref = manifest.payload.dormantState?.automationRunHistory
  if (!ref) {
    return manifest
  }
  const descriptor = topodMigrationAutomationRunHistoryBlob(ref)
  return withTopodMigrationAutomationRunHistory(
    manifest,
    readTopodMigrationBlob(manifest, blobRoot, descriptor).toString('utf8')
  )
}
