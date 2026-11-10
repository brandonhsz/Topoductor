import { createHash, randomUUID } from 'node:crypto'

import {
  TOPOD_MIGRATION_MANIFEST_VERSION,
  parseTopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest-validation'

import type {
  TopodMigrationCatalogPayload,
  TopodMigrationManifest
} from '../../../shared/topod-migration/topod-migration-manifest'

import { TOPOD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationBlobDescriptor } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import {
  topodMigrationAutomationRunHistoryBlob,
  serializeTopodMigrationAutomationRunHistory,
  withTopodMigrationAutomationRunHistory
} from '../../../shared/topod-migration/topod-migration-automation-run-history'

import type { SshTarget } from '../../../shared/ssh-types'
import type { Store } from '../loading-store/store'
import { collectTopodMigrationSourceCatalog } from './topod-source-catalog'
import { computeTopodMigrationManifestSha256 } from '../../topod/topod-migration-manifest-digest'
import {
  IDENTITY_TOPOD_MIGRATION_PATH_REWRITER,
  rewriteTopodMigrationPayloadPaths
} from './path-rewrite/topod-migration-path-rewrite'

import type { TopodMigrationPathRewriter } from './path-rewrite/topod-migration-path-rewrite'
import {
  TOPOD_MIGRATION_MANIFEST_TOO_LARGE,
  describeOversizedTopodMigrationPayload,
  formatKib
} from '../../managed-server/migration/catalog/topod-migration-payload-capacity'

import { hasDormantState } from './topod-migration-dormant-state'

export type TopodMigrationExportStore = Pick<
  Store,
  | 'collectTopodMigrationSourceDormantState'
  | 'getFolderWorkspaces'
  | 'getProjectGroups'
  | 'getRepos'
> & {
  /** Groups the server's record wins for: still read for row ownership, never exported. */
  serverOwnedProjectGroupIds?: ReadonlySet<string>
}

export type TopodMigrationManifestExportOptions = {
  migrationId?: string
  now?: () => Date
  destinationEnvironmentId?: string
  onlyCatalog?: TopodMigrationCatalogIds
  /** Maps source paths to destination paths before signing; identity for an SSH host. */
  rewrite?: TopodMigrationPathRewriter
  /** Re-export a journal written before run history moved out of the manifest, as it was signed. */
  inlineAutomationRuns?: boolean
}

export type TopodMigrationExportedBlob = {
  descriptor: TopodMigrationBlobDescriptor
  bytes: Buffer
}

export type TopodMigrationManifestExport = {
  manifest: TopodMigrationManifest
  /** The bytes of every blob the manifest names. */
  blobs: TopodMigrationExportedBlob[]
}

export function createTopodMigrationManifest(
  store: TopodMigrationExportStore,
  target: SshTarget,
  options: TopodMigrationManifestExportOptions = {}
): TopodMigrationManifest {
  return exportTopodMigrationManifest(store, target, options).manifest
}

export function exportTopodMigrationManifest(
  store: TopodMigrationExportStore,
  target: SshTarget,
  options: TopodMigrationManifestExportOptions = {}
): TopodMigrationManifestExport {
  const rewrite = options.rewrite ?? IDENTITY_TOPOD_MIGRATION_PATH_REWRITER
  const collected = restrictCatalog(
    collectTopodMigrationSourceCatalog(store, target),
    options.onlyCatalog
  )
  const serverOwned = store.serverOwnedProjectGroupIds
  const sourcePayload = serverOwned
    ? {
        ...collected,
        projectGroups: collected.projectGroups.filter((group) => !serverOwned.has(group.id))
      }
    : collected
  const source = {
    sshTargetId: target.id,
    sshTargetGeneration: target.generation ?? null,
    targetLabel: target.label
  }
  const dormantState = store.collectTopodMigrationSourceDormantState(
    source,
    sourcePayload,
    options.destinationEnvironmentId
  )
  // Select dormant state using source identities before rewriting destination paths.
  const rewritten = rewriteTopodMigrationPayloadPaths(
    { ...sourcePayload, ...(hasDormantState(dormantState) ? { dormantState } : {}) },
    rewrite
  )
  const { payload, runHistory } = options.inlineAutomationRuns
    ? { payload: rewritten, runHistory: null }
    : moveAutomationRunsToBlob(rewritten)
  const unsigned = {
    version: TOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: options.migrationId ?? randomUUID(),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    source,
    payload,
    ...(options.destinationEnvironmentId
      ? { destinationEnvironmentId: options.destinationEnvironmentId }
      : {})
  }
  try {
    // Sign what the journal and the host read back: the parsed form (the parser keeps only the fields
    // it knows) of the JSON (a value with toJSON serializes differently), never the live objects.
    const { manifestSha256: _unsigned, ...normalized } = parseTopodMigrationManifest({
      ...JSON.parse(JSON.stringify(unsigned)),
      manifestSha256: UNSIGNED_DIGEST
    })
    if (runHistory) {
      // Refuse here what the destination's commit would refuse, while nothing is fenced.
      withTopodMigrationAutomationRunHistory(normalized, runHistory.bytes.toString('utf8'))
    }
    return {
      manifest: { ...normalized, manifestSha256: computeTopodMigrationManifestSha256(normalized) },
      blobs: runHistory ? [runHistory] : []
    }
  } catch (error) {
    if (error instanceof Error && error.message === TOPOD_MIGRATION_MANIFEST_TOO_LARGE) {
      throw new Error(describeOversizedTopodMigrationPayload(payload))
    }
    throw error
  }
}

/** Run history scales with every run ever kept, so it travels beside the manifest, never in it. */
function moveAutomationRunsToBlob(payload: TopodMigrationCatalogPayload): {
  payload: TopodMigrationCatalogPayload
  runHistory: TopodMigrationExportedBlob | null
} {
  if (!payload.dormantState?.automationRuns?.length) {
    return { payload, runHistory: null }
  }
  const { automationRuns, ...dormantState } = payload.dormantState
  // The JSON round trip matches what the manifest's own normalization keeps.
  const bytes = Buffer.from(
    serializeTopodMigrationAutomationRunHistory(JSON.parse(JSON.stringify(automationRuns))),
    'utf8'
  )
  const maxBytes = TOPOD_MIGRATION_BLOB_KIND_CONTRACTS['automation-run-history'].maxBytes
  if (bytes.length > maxBytes) {
    throw new Error(
      `This SSH host's automation run history is too large to move to its Topo server ` +
        `(${formatKib(bytes.length)}, limit ${formatKib(maxBytes)}). Delete automations you no ` +
        `longer need from this host's projects; their run history goes with them. Then reconnect. ` +
        `(topod_migration_automation_run_history_too_large)`
    )
  }
  const ref = { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
  return {
    payload: {
      ...payload,
      dormantState: { ...dormantState, automationRunHistory: ref }
    },
    runHistory: { descriptor: topodMigrationAutomationRunHistoryBlob(ref), bytes }
  }
}

const UNSIGNED_DIGEST = '0'.repeat(64)

export type TopodMigrationCatalogIds = {
  repositoryIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
  projectGroupIds: ReadonlySet<string>
}

export function topodMigrationCatalogIds(
  payloads: readonly TopodMigrationCatalogPayload[]
): TopodMigrationCatalogIds {
  return {
    repositoryIds: new Set(payloads.flatMap((p) => p.repositories.map((row) => row.id))),
    folderWorkspaceIds: new Set(payloads.flatMap((p) => p.folderWorkspaces.map((row) => row.id))),
    projectGroupIds: new Set(payloads.flatMap((p) => p.projectGroups.map((row) => row.id)))
  }
}

function restrictCatalog(
  payload: TopodMigrationCatalogPayload,
  ids: TopodMigrationCatalogIds | undefined
): TopodMigrationCatalogPayload {
  if (!ids) {
    return payload
  }
  return {
    repositories: payload.repositories.filter((row) => ids.repositoryIds.has(row.id)),
    folderWorkspaces: payload.folderWorkspaces.filter((row) => ids.folderWorkspaceIds.has(row.id)),
    projectGroups: payload.projectGroups.filter((row) => ids.projectGroupIds.has(row.id))
  }
}
