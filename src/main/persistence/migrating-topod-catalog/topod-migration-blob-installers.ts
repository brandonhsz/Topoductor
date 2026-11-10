// Validate blob contents before commit; install only advertised kinds after durable commit.
import { servesWslMovedPaneHistory } from '../../topod/topod-migration-wsl-destination'
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TopodMigrationBlobKind } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import type { TopodMigrationManifest } from '../../../shared/topod-migration/topod-migration-manifest'
import {
  TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseTopodMigrationTerminalRestoreHintsText,
  type TopodMigrationTerminalRestoreHint
} from '../../../shared/topod-migration/topod-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../filesystem/durable-file-write'
import {
  getTopodMigrationReceivedBlobPath,
  stagedTopodMigrationBlobFiles
} from './topod-migration-blob-staging'
import {
  topodMigrationStagingKey,
  type TopodMigrationRequestIdentity
} from './topod-migration-staged-file'
import {
  assertTopodMigrationShellHistoryValid,
  installTopodMigrationShellHistory
} from './topod-shell-history-installer'
import {
  assertTopodMigrationTerminalHistoryValid,
  installTopodMigrationTerminalHistory
} from './topod-terminal-history-installer'
import type {
  TopodTerminalRestoreHintPlacement,
  TopodTerminalRestoreHintStore
} from './topod-terminal-restore-hint-store'

type TopodMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: TopodMigrationManifest
}

type TopodMigrationBlobContentCheck = (file: TopodMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<Record<TopodMigrationBlobKind, TopodMigrationBlobContentCheck>> =
  {
    'terminal-restore-hints': ({ path }) => {
      parseTopodMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
    },
    'shell-history': ({ key, path, manifest }) => {
      assertTopodMigrationShellHistoryValid(key, path, manifest.payload)
    },
    'terminal-history': ({ key, path, manifest }) => {
      assertTopodMigrationTerminalHistoryValid(key, path, manifest)
    }
  }

/** Reject malformed content before commit while the source still owns everything. */
export function assertTopodMigrationBlobContentsValid(
  manifest: TopodMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedTopodMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`topod_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type TopodMigrationBlobInstall = {
  migration: TopodMigrationRequestIdentity
  root: string
  terminalRestoreHints: TopodTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  /** This host's `getDaemonHistoryDir()`, where its terminals' checkpoints live. */
  terminalHistoryRoot: string
  /** The shell binary a new pane on this host would actually run. */
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  /** The workspace's folder on this host, or null when it is not here. */
  workspacePath: (worktreeId: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installTopodMigrationReceivedBlobs(install: TopodMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [
    installTerminalRestoreHints,
    installShellHistory,
    installTerminalHistory,
    removeImportedAutomationRunHistory
  ]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

// The durable commit already holds these runs; the blob only served that commit.
function removeImportedAutomationRunHistory(install: TopodMigrationBlobInstall): void {
  rmSync(
    getTopodMigrationReceivedBlobPath(install.root, install.migration, {
      blobKind: 'automation-run-history',
      key: 'migration'
    }),
    { force: true }
  )
}

function installTerminalHistory(install: TopodMigrationBlobInstall): void {
  // Only a WSL host advertises terminal history, so no other destination should hold any.
  if (!servesWslMovedPaneHistory()) {
    return
  }
  installTopodMigrationTerminalHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.terminalHistoryRoot,
    paneWorktreeId: install.paneWorktreeId,
    workspacePath: install.workspacePath,
    now: install.now
  })
}

function installShellHistory(install: TopodMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installTopodMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: TopodMigrationBlobInstall): void {
  const path = getTopodMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = topodMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseTopodMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[topod-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly TopodMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): TopodTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('topod_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('topod_migration_terminal_restore_')
}
