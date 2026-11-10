import { TOPOD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { parsePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import { getDaemonHistoryDir } from '../../daemon/launch/daemon-launch-paths'
import { getHistoryRoot } from '../../pty/history/terminal-history-paths'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  findTopodMigrationImportReceipt,
  isTopodMigrationCommitDurable
} from './topod-catalog-receipt-ledger'
import { installTopodMigrationReceivedBlobs } from './topod-migration-blob-installers'
import { listTopodMigrationReceivedBlobNames } from './topod-migration-blob-staging'
import type { TopodMigrationRequestIdentity } from './topod-migration-staged-file'

type TopodMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'topodMigrationBlobRoot'
  | 'topodTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'topodMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const topodMigrationBlobInstallContext = Symbol('TopodMigrationBlobInstallPersistence')
type TopodMigrationBlobInstallContext = {
  runtime: TopodMigrationBlobInstallRuntime
}

export class TopodMigrationBlobInstallPersistence {
  readonly [topodMigrationBlobInstallContext]: TopodMigrationBlobInstallContext

  constructor(runtime: TopodMigrationBlobInstallRuntime) {
    this[topodMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installTopodMigrationReceivedBlobs(
    manifest: TopodMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findTopodMigrationImportReceipt(
      this[topodMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[topodMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingTopodMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[topodMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.topodMigrationImportReceipts ?? []),
      ...(runtime.state.topodMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[topod-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingTopodMigrationShellHistory(): boolean {
    const { runtime } = this[topodMigrationBlobInstallContext]
    return [
      ...(runtime.state.topodMigrationImportReceipts ?? []),
      ...(runtime.state.topodMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listTopodMigrationReceivedBlobNames(
        runtime.topodMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => TOPOD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredTopodMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[topodMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingTopodMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekTopodMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[topodMigrationBlobInstallContext].runtime.topodTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeTopodMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[topodMigrationBlobInstallContext].runtime.topodTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: TopodMigrationBlobInstallRuntime,
  migration: TopodMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isTopodMigrationCommitDurable(runtime, migration)) {
    return
  }
  installTopodMigrationReceivedBlobs({
    migration,
    root: runtime.topodMigrationBlobRoot,
    terminalRestoreHints: runtime.topodTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    terminalHistoryRoot: getDaemonHistoryDir(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    workspacePath: (worktreeId) => findWorkspacePath(runtime.state, worktreeId),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

// A git worktree id carries its path; a folder workspace's is on its record.
function findWorkspacePath(state: PersistedState, worktreeId: string): string | null {
  const separator = worktreeId.indexOf('::')
  if (separator > 0) {
    return worktreeId.slice(separator + 2) || null
  }
  return state.folderWorkspaces.find((folder) => folder.id === worktreeId)?.folderPath ?? null
}

// The commit merged the moved session in with its worktree ids unchanged.
function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
