import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../constants'
import {
  assertTopodMigrationScrollbackReferences,
  parseTopodMigrationSnapshotChunkResult,
  parseTopodMigrationTerminalScrollbackSnapshots,
  type TopodMigrationSnapshotChunkRequest,
  type TopodMigrationTerminalScrollbackSnapshot
} from './topod-migration-scrollback'

const DIGEST = 'a'.repeat(64)

describe('topod migration scrollback wire validation', () => {
  it('requires an acknowledgment for exactly the decoded chunk length', () => {
    const request = chunkRequest(Buffer.from('abc').toString('base64'), 7)
    expect(
      parseTopodMigrationSnapshotChunkResult(
        {
          migrationId: request.migrationId,
          manifestSha256: request.manifestSha256,
          ref: request.ref,
          acknowledgedOffset: 10
        },
        request
      ).acknowledgedOffset
    ).toBe(10)
    for (const acknowledgedOffset of [7, 9, 11]) {
      expect(() =>
        parseTopodMigrationSnapshotChunkResult(
          {
            migrationId: request.migrationId,
            manifestSha256: request.manifestSha256,
            ref: request.ref,
            acknowledgedOffset
          },
          request
        )
      ).toThrow('topod_migration_snapshot_chunk_result_invalid')
    }
  })

  it('requires unique refs and tab/leaf identities', () => {
    const first = descriptor(1)
    expect(() =>
      parseTopodMigrationTerminalScrollbackSnapshots([first, { ...descriptor(2), ref: first.ref }])
    ).toThrow('topod_migration_dormant_scrollback_snapshot_ref_duplicate')
    expect(() =>
      parseTopodMigrationTerminalScrollbackSnapshots([
        first,
        { ...descriptor(2), tabId: first.tabId, leafId: first.leafId }
      ])
    ).toThrow('topod_migration_dormant_scrollback_snapshot_leaf_duplicate')
  })

  it('requires one exact descriptor for every published session ref', () => {
    const session = getDefaultWorkspaceSession()
    const first = descriptor(1)
    session.terminalLayoutsByTabId = {
      [first.tabId]: {
        root: { type: 'leaf', leafId: first.leafId },
        activeLeafId: first.leafId,
        expandedLeafId: null,
        scrollbackRefsByLeafId: { [first.leafId]: first.ref }
      }
    }
    expect(() => assertTopodMigrationScrollbackReferences(session, [first])).not.toThrow()
    expect(() => assertTopodMigrationScrollbackReferences(session, [])).toThrow(
      'topod_migration_dormant_scrollback_reference_invalid'
    )
    expect(() =>
      assertTopodMigrationScrollbackReferences(session, [{ ...first, ref: descriptor(2).ref }])
    ).toThrow('topod_migration_dormant_scrollback_reference_invalid')
    expect(() => assertTopodMigrationScrollbackReferences(session, [first, descriptor(2)])).toThrow(
      'topod_migration_dormant_scrollback_reference_invalid'
    )
  })
})

function chunkRequest(bytesBase64: string, offset = 0): TopodMigrationSnapshotChunkRequest {
  return {
    migrationId: 'migration-1',
    manifestSha256: DIGEST,
    ref: `v1-${'1'.repeat(32)}`,
    offset,
    bytesBase64
  }
}

function descriptor(index: number): TopodMigrationTerminalScrollbackSnapshot {
  const identity = index.toString(16).padStart(32, '0')
  return {
    tabId: `tab-${index}`,
    leafId: `leaf-${index}`,
    ref: `v1-${identity}`,
    sha256: index.toString(16).padStart(64, '0'),
    byteLength: 1
  }
}
