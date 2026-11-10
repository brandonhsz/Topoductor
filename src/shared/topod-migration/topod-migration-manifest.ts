import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { Automation } from '../automations/automation-definition'
import type { AutomationRun } from '../automations/history/automation-run'
import type { TopodMigrationManifestVersion } from './topod-migration-manifest-validation'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session/workspace-session-state-types'
import type { TopodMigrationClientStatePayload } from './topod-migration-client-state'
import type {
  TopodMigrationSnapshotUploadState,
  TopodMigrationTerminalScrollbackSnapshot
} from './topod-migration-scrollback'
import type { TopodMigrationBlobUploadState } from './topod-migration-blob-transfer'

import { isRecord } from './topod-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see topod-migration-source-kind). */
export type TopodMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type TopodMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type TopodMigrationManifestSource =
  | TopodMigrationSshManifestSource
  | TopodMigrationLocalWslManifestSource

export type TopodMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: TopodMigrationDormantStatePayload
}

export type TopodMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type TopodMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type TopodMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type TopodMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type TopodMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type TopodMigrationAutomationRunHistoryRef = {
  sha256: string
  byteLength: number
}

export type TopodMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: TopodMigrationDormantWorktreeMeta[]
  worktreeLineage: TopodMigrationDormantWorktreeLineage[]
  workspaceLineage: TopodMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: TopodMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: TopodMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: TopodMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  /** Inline runs, as older desktops send them; never alongside `automationRunHistory`. */
  automationRuns?: AutomationRun[]
  /** Digest of the runs sent as an `automation-run-history` blob, so history never bounds the manifest. */
  automationRunHistory?: TopodMigrationAutomationRunHistoryRef
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: TopodMigrationClientStatePayload
}

export type TopodMigrationManifest = {
  version: TopodMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: TopodMigrationManifestSource
  payload: TopodMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type TopodMigrationImportReceipt = {
  version: TopodMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: TopodMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type TopodMigrationStagedCatalog = {
  version: TopodMigrationManifestVersion
  manifest: TopodMigrationManifest
  stagedAt: string
}

export type TopodMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: TopodMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: TopodMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: TopodMigrationImportReceipt
    }

export type TopodMigrationCatalogAbortResult = TopodMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type TopodMigrationCatalogReference = Pick<
  TopodMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type TopodMigrationCatalogReferenceAbortResult = TopodMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
  /** The receipt was flushed before this answer; older hosts never send it. */
  durableCommitted?: true
}

export function topodMigrationManifestHashInput(
  manifest: Omit<TopodMigrationManifest, 'manifestSha256'>
): string {
  return serializeTopodMigrationValue(manifest)
}

export function serializeTopodMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
