import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { topodMigrationCutoverFixture as cutover } from '../../managed-server/migration/cutover/testing/topod-migration-cutover-fixture'
import {
  findTopodMigrationSourceCutoverForTarget,
  listTopodMigrationSourceCutovers,
  topodMigrationCutoverJournalDirectory,
  removeTopodMigrationSourceCutover,
  writeTopodMigrationSourceCutover
} from './topod-migration-cutover-journal'

let userDataPath: string
beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'topod-cutover-journal-'))
})
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

const journalPath = (id: string) =>
  join(topodMigrationCutoverJournalDirectory(userDataPath), `${id}.json`)

describe('migration cutover journal sidecar', () => {
  it('round-trips a cutover in an owner-only file', () => {
    writeTopodMigrationSourceCutover(userDataPath, cutover())
    expect(findTopodMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toEqual(cutover())
    if (process.platform !== 'win32') {
      expect(statSync(journalPath('migration-1')).mode & 0o077).toBe(0)
    }
    removeTopodMigrationSourceCutover(userDataPath, 'migration-1')
    expect(listTopodMigrationSourceCutovers(userDataPath)).toEqual([])
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a manifest bound to another target', JSON.stringify({ ...cutover(), sshTargetId: 'ssh-2' })],
    ['a tampered manifest', JSON.stringify({ ...cutover(), manifestSha256: 'f'.repeat(64) })],
    ['an unknown version', JSON.stringify({ ...cutover(), version: 2 })]
  ])('fails closed on %s', (_label, contents) => {
    mkdirSync(topodMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), contents)
    expect(() => listTopodMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it("reads a newer build's journal that adds an optional field", () => {
    mkdirSync(topodMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), JSON.stringify({ ...cutover(), addedLater: true }))
    expect(listTopodMigrationSourceCutovers(userDataPath)).toEqual([cutover()])
  })

  it('fails closed on a file whose name disagrees with its migration', () => {
    mkdirSync(topodMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('other'), JSON.stringify(cutover()))
    expect(() => listTopodMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it('ignores durable-write temporaries but refuses two journals for one target', () => {
    writeTopodMigrationSourceCutover(userDataPath, cutover())
    writeFileSync(join(topodMigrationCutoverJournalDirectory(userDataPath), 'x.json.tmp'), '?')
    expect(listTopodMigrationSourceCutovers(userDataPath)).toHaveLength(1)
    writeTopodMigrationSourceCutover(userDataPath, cutover('migration-2'))
    expect(() => findTopodMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toThrow(
      'journals name SSH target'
    )
  })
})
