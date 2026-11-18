// The worker's single door to the local database: opens it, migrates what older versions kept in
// the plugin's storage, keeps writes in order and tells open panels when something changed.
import type { OrcaWorkerApi } from 'orca/worker'
import { defaultDatabasePath, type CatalogDb } from './catalog-db'
import { readCatalog } from './catalog-storage'
import { isCatalog } from './json-fields'
import type { MeliReading, Product, ReferralProposal } from './protocol'

export type OpenCatalogDb = (path: string) => CatalogDb

export class CatalogRepository {
  private opened: CatalogDb | null = null
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly open: OpenCatalogDb
  ) {}

  async database(): Promise<CatalogDb> {
    if (!this.opened) {
      const configured = await this.orca.settings.get('databasePath')
      const path = typeof configured === 'string' && configured.trim() ? configured.trim() : null
      const db = this.open(path ?? defaultDatabasePath())
      await this.migrateStorage(db)
      this.opened = db
    }
    return this.opened
  }

  /** Before SQLite the catalog lived in storage shards, and before that in one `catalog` key. */
  private async migrateStorage(db: CatalogDb): Promise<void> {
    const keys = (await this.orca.storage.keys()).filter((key) => key.startsWith('catalog'))
    if (keys.length === 0) {
      return
    }
    if (db.all().length === 0) {
      const sharded = await readCatalog(this.orca.storage)
      const legacy = await this.orca.storage.get('catalog')
      const old = sharded.products.length > 0 ? sharded : isCatalog(legacy) ? legacy : null
      if (old) {
        db.save(old.products, { replace: true, syncedAt: old.syncedAt ?? undefined })
      }
    }
    for (const key of keys) {
      await this.orca.storage.delete(key)
    }
  }

  async products(): Promise<Product[]> {
    return (await this.database()).all()
  }

  /** Runs one write at a time, so the audit and referral jobs never drop each other's changes. */
  private serial(write: (db: CatalogDb) => void | Promise<void>): Promise<void> {
    const next = this.writes.then(async () => {
      await write(await this.database())
      this.orca.panels.post('catalog.changed', { at: Date.now() })
    })
    this.writes = next.catch(() => undefined)
    return next
  }

  update(change: (products: Product[]) => Product[]): Promise<void> {
    return this.serial((db) => db.save(change(db.all())))
  }

  replace(products: readonly Product[], syncedAt: number): Promise<void> {
    return this.serial((db) => db.save(products, { replace: true, syncedAt }))
  }

  recordReadings(readings: readonly (MeliReading & { url: string })[]): Promise<void> {
    return this.serial((db) => db.recordReadings(readings))
  }

  recordAttempts(attempts: readonly [string, string, ReferralProposal][]): Promise<void> {
    return this.serial((db) => {
      for (const [productId, target, proposal] of attempts) {
        db.recordAttempt(productId, target, proposal)
      }
    })
  }
}
