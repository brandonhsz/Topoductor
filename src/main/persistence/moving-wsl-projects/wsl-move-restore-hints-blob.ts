import { createHash } from 'node:crypto'
import type { TopodMigrationBlobDescriptor } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import { sameTopodMigrationBlob } from '../../../shared/topod-migration/topod-migration-blob-transfer'
import {
  MAX_TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseTopodMigrationTerminalRestoreHintsDocument,
  type TopodMigrationTerminalRestoreHint
} from '../../../shared/topod-migration/topod-migration-terminal-restore-hints'
import type { TopodMigrationBlobSource } from '../../managed-server/migration/transfers/topod-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: TopodMigrationBlobDescriptor
  bytes: Buffer
  source: TopodMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly TopodMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseTopodMigrationTerminalRestoreHintsDocument({
    version: TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('topod_migration_terminal_restore_hints_too_large')
  }
  const descriptor: TopodMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: TOPOD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameTopodMigrationBlob(requested, descriptor)) {
          throw new Error(`topod_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
