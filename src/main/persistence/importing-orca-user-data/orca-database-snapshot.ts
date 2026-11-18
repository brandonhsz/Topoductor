import { randomUUID } from 'node:crypto'
import { access, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import { PROFILE_STATE_DATABASE_SCHEMA_VERSION } from '../profile-state/profile-state-database-schema'
import { writeProfileStateDatabaseSnapshotAsync } from '../profile-state/profile-state-database-snapshot'

const BUSY_TIMEOUT_MS = 5_000

export class FutureOrcaProfileSchemaError extends Error {
  constructor(readonly schemaVersion: number) {
    super(
      `Orca profile state schema ${schemaVersion} is newer than Topo's ${PROFILE_STATE_DATABASE_SCHEMA_VERSION}`
    )
    this.name = 'FutureOrcaProfileSchemaError'
  }
}

/** Snapshot an Orca SQLite database (including its WAL) into Topo's staging area. */
export async function snapshotOrcaDatabase(
  sourcePath: string,
  targetPath: string,
  scratchDir: string
): Promise<void> {
  await withOrcaDatabase(sourcePath, scratchDir, async (db) => {
    await db.backup(targetPath)
    assertIntegrity(targetPath)
    hardenSqliteDatabaseFiles(targetPath)
  })
}

export async function snapshotOrcaProfileStateDatabase(
  sourcePath: string,
  targetPath: string,
  scratchDir: string
): Promise<void> {
  await withOrcaDatabase(sourcePath, scratchDir, async (db) => {
    const schemaVersion = Number(db.pragma('user_version', { simple: true }))
    // Copying a future schema would make Topo refuse or misread the profile.
    if (schemaVersion > PROFILE_STATE_DATABASE_SCHEMA_VERSION) {
      throw new FutureOrcaProfileSchemaError(schemaVersion)
    }
    await writeProfileStateDatabaseSnapshotAsync(db, targetPath, {
      validateStagedSnapshot: assertIntegrity
    })
  })
}

async function withOrcaDatabase(
  sourcePath: string,
  scratchDir: string,
  snapshot: (db: Database.Database) => Promise<void>
): Promise<void> {
  // A read-only open of a database without sidecars would create them inside Orca's folder.
  if (await hasWalSidecars(sourcePath)) {
    const live = openProbed(sourcePath, true)
    if (live) {
      try {
        return await snapshot(live)
      } finally {
        live.close()
      }
    }
  }
  const copyPath = join(scratchDir, `${randomUUID()}.db`)
  try {
    for (const suffix of ['', '-wal', '-journal']) {
      await copyFile(`${sourcePath}${suffix}`, `${copyPath}${suffix}`).catch((error: unknown) => {
        if (suffix === '' || !isMissingPath(error)) {
          throw error
        }
      })
    }
    const copy = openProbed(copyPath, false)
    if (!copy) {
      throw new Error(`Orca database is unreadable: ${sourcePath}`)
    }
    try {
      await snapshot(copy)
    } finally {
      copy.close()
    }
  } finally {
    await Promise.all(
      ['', '-wal', '-shm', '-journal'].map((suffix) => rm(`${copyPath}${suffix}`, { force: true }))
    )
  }
}

function openProbed(path: string, readonly: boolean): Database.Database | null {
  let db: Database.Database | null = null
  try {
    db = new Database(path, { readonly, fileMustExist: true, timeout: BUSY_TIMEOUT_MS })
    // Opening is lazy; the first read surfaces WAL recovery or lock failures.
    db.pragma('user_version', { simple: true })
    return db
  } catch (error) {
    db?.close()
    console.warn('[orca-import] Could not open Orca database directly:', path, error)
    return null
  }
}

// Writable so closing removes the WAL sidecars a WAL-mode copy would otherwise leave behind.
function assertIntegrity(path: string): void {
  const db = new Database(path, { fileMustExist: true })
  try {
    const result = db.pragma('integrity_check', { simple: true })
    if (result !== 'ok') {
      throw new Error(`Imported database failed integrity_check (${String(result)}): ${path}`)
    }
  } finally {
    db.close()
  }
}

async function hasWalSidecars(databasePath: string): Promise<boolean> {
  for (const suffix of ['-wal', '-shm']) {
    try {
      await access(`${databasePath}${suffix}`)
      return true
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error
      }
    }
  }
  return false
}

export function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
