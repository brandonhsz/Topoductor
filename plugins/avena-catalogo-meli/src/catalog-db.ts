// The local record of the catalog: current products, every price reading and every referral
// attempt. Mongo stays the source and the backend the only writer to production.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hasNewMlPrice, isApplicable } from './catalog-status'
import { isRecord } from './json-fields'
import type {
  BulkScope,
  CatalogView,
  CatalogViewQuery,
  MeliReading,
  Product,
  ProductHistory,
  ProductStatus,
  ReferralProposal
} from './protocol'

const REVIEW_STATUSES: readonly ProductStatus[] = [
  'precio_cambio',
  'sin_precio_base',
  'revisar_salto',
  'revisar_identidad',
  'otra_presentacion',
  'link_compartido',
  'roto',
  'link_directo',
  'referido_rechazado',
  'referido_listo'
]

const SORT_COLUMNS: Record<string, string> = {
  producto: 'label',
  estatus: 'status',
  guardado: 'price',
  ml: 'ml_price',
  dif: 'diff_pct'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  link_kind TEXT NOT NULL,
  price REAL,
  ml_price REAL,
  diff_pct REAL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_status ON products(status);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_url TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  price REAL,
  list_price REAL,
  discount_percentage REAL,
  title TEXT,
  seller TEXT,
  ml_item_id TEXT
);
CREATE INDEX IF NOT EXISTS readings_url ON readings(product_url, checked_at);
CREATE TABLE IF NOT EXISTS referral_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  referral TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_product ON referral_attempts(product_id, created_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Where the database lives when the settings name no path: the OS's per-user data folder. */
export function defaultDatabasePath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const folder = 'topo-catalogo-mercadolibre'
  if (platform === 'win32') {
    return join(env.USERPROFILE ?? '.', 'AppData', 'Roaming', folder, 'catalog.db')
  }
  if (platform === 'darwin') {
    return join(env.HOME ?? '.', 'Library', 'Application Support', folder, 'catalog.db')
  }
  return join(env.HOME ?? '.', '.local', 'share', folder, 'catalog.db')
}

function parseProduct(data: unknown): Product | null {
  if (typeof data !== 'string') {
    return null
  }
  const parsed: unknown = JSON.parse(data)
  return isRecord(parsed) && typeof parsed.id === 'string' ? toProduct(parsed) : null
}

// Rows hold what this plugin wrote; the guard only keeps a hand-edited file from crashing it.
function toProduct(record: Record<string, unknown>): Product {
  const product: Product = JSON.parse(JSON.stringify(record))
  return product
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export class CatalogDb {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true })
    }
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  syncedAt(): number | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'syncedAt'").get()
    return row ? Number(row.value) : null
  }

  all(): Product[] {
    return this.db
      .prepare('SELECT data FROM products ORDER BY label')
      .all()
      .flatMap((row) => parseProduct(row.data) ?? [])
  }

  /** Writes changed products; with `replace`, products missing from the list are dropped. */
  save(products: readonly Product[], options: { replace?: boolean; syncedAt?: number } = {}): void {
    const upsert = this.db.prepare(`
      INSERT INTO products (id, label, status, link_kind, price, ml_price, diff_pct, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, status = excluded.status,
        link_kind = excluded.link_kind, price = excluded.price, ml_price = excluded.ml_price,
        diff_pct = excluded.diff_pct, data = excluded.data`)
    this.db.exec('BEGIN')
    try {
      if (options.replace) {
        this.db.exec('DELETE FROM products')
      }
      for (const product of products) {
        upsert.run(
          product.id,
          `${product.brand} ${product.name}`.toLowerCase(),
          product.status,
          product.linkKind,
          product.price,
          product.reading?.ok ? product.reading.price : null,
          product.diffPct,
          JSON.stringify(product)
        )
      }
      if (options.syncedAt !== undefined) {
        this.db
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('syncedAt', ?)")
          .run(String(options.syncedAt))
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  recordReadings(readings: readonly (MeliReading & { url: string })[]): void {
    const insert = this.db.prepare(`
      INSERT INTO readings (product_url, checked_at, ok, price, list_price, discount_percentage,
        title, seller, ml_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const reading of readings) {
      insert.run(
        reading.url,
        reading.checkedAt,
        reading.ok ? 1 : 0,
        reading.price,
        reading.listPrice,
        reading.discountPercentage,
        reading.title,
        reading.seller,
        reading.mlItemId
      )
    }
  }

  recordAttempt(productId: string, targetUrl: string, proposal: ReferralProposal): void {
    this.db
      .prepare(
        `INSERT INTO referral_attempts (product_id, target_url, referral, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(productId, targetUrl, proposal.url, proposal.reason, proposal.createdAt)
  }

  view(query: CatalogViewQuery): CatalogView {
    const where: string[] = []
    const params: (string | number)[] = []
    if (query.filter === 'revisar') {
      where.push(`status IN (${REVIEW_STATUSES.map(() => '?').join(', ')})`)
      params.push(...REVIEW_STATUSES)
    } else if (query.filter === 'con_referido') {
      where.push("link_kind = 'referido'")
    } else if (query.filter !== 'todos') {
      where.push('status = ?')
      params.push(query.filter)
    }
    if (query.search.trim()) {
      where.push('label LIKE ?')
      params.push(`%${query.search.trim().toLowerCase()}%`)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const column = SORT_COLUMNS[query.sort.column] ?? 'label'
    const direction = query.sort.direction === 'desc' ? 'DESC' : 'ASC'
    const rows = this.db
      .prepare(
        `SELECT data FROM products ${clause} ORDER BY ${column} IS NULL, ${column} ${direction}, label LIMIT ?`
      )
      .all(...params, query.limit)
      .flatMap((row) => parseProduct(row.data) ?? [])
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM products ${clause}`).get(...params)?.n ?? 0
    )
    const counts: Partial<Record<ProductStatus, number>> = {}
    for (const row of this.db
      .prepare('SELECT status, COUNT(*) AS n FROM products GROUP BY status')
      .all()) {
      const status = REVIEW_STATUSES.concat(['ok', 'sin_revisar']).find(
        (known) => known === row.status
      )
      if (status) {
        counts[status] = Number(row.n)
      }
    }
    const single = (sql: string): number => Number(this.db.prepare(sql).get()?.n ?? 0)
    return {
      rows,
      total,
      counts,
      syncedAt: this.syncedAt(),
      all: single('SELECT COUNT(*) AS n FROM products'),
      withReferral: single("SELECT COUNT(*) AS n FROM products WHERE link_kind = 'referido'"),
      direct: single("SELECT COUNT(*) AS n FROM products WHERE link_kind = 'directo'"),
      applicable: this.all().filter(isApplicable).length,
      pendingReferrals: single(
        "SELECT COUNT(*) AS n FROM products WHERE status = 'referido_listo'"
      ),
      withNewPrice: this.all().filter(hasNewMlPrice).length
    }
  }

  history(productId: string): ProductHistory | null {
    const row = this.db.prepare('SELECT data FROM products WHERE id = ?').get(productId)
    const product = row ? parseProduct(row.data) : null
    if (!product) {
      return null
    }
    const readings = this.db
      .prepare(
        `SELECT checked_at, ok, price, list_price, discount_percentage, seller
         FROM readings WHERE product_url = ? ORDER BY checked_at DESC LIMIT 30`
      )
      .all(product.productURL)
      .map((reading) => ({
        checkedAt: Number(reading.checked_at),
        ok: reading.ok === 1,
        price: num(reading.price),
        listPrice: num(reading.list_price),
        discountPercentage: num(reading.discount_percentage),
        seller: str(reading.seller)
      }))
    const attempts = this.db
      .prepare(
        `SELECT target_url, referral, reason, created_at FROM referral_attempts
         WHERE product_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(productId)
      .map((attempt) => ({
        targetUrl: String(attempt.target_url),
        referral: str(attempt.referral),
        reason: str(attempt.reason),
        createdAt: Number(attempt.created_at)
      }))
    return { product, readings, attempts }
  }

  /** Ids for the bulk buttons: safe price changes, or generated referrals not saved yet. */
  ids(scope: BulkScope): string[] {
    return this.all()
      .filter((product) =>
        scope === 'allPrices'
          ? hasNewMlPrice(product)
          : scope === 'applicable'
            ? isApplicable(product)
            : product.status === 'referido_listo'
      )
      .map((product) => product.id)
  }
}
