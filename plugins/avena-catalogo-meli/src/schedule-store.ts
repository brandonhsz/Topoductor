// Scheduled tasks, their run history and the mock purchase-order queue, in the plugin's SQLite file.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isRecord } from './json-fields'
import type {
  OrderItemResult,
  OrderStatus,
  PurchaseOrder,
  Schedule,
  ScheduleRun,
  TaskKind
} from './schedule-types'
import { TASK_LABELS } from './schedule-types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, days TEXT NOT NULL, time TEXT NOT NULL,
  enabled INTEGER NOT NULL, mode TEXT NOT NULL, next_run_at INTEGER, last_run_at INTEGER
);
CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT, kind TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, ok INTEGER NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && value in TASK_LABELS
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }
  const parsed: T = JSON.parse(value)
  return parsed
}

export class ScheduleStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true })
    }
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(schedules)').all()
    if (!columns.some((column) => column.name === 'every_hours')) {
      this.db.exec('ALTER TABLE schedules ADD COLUMN every_hours INTEGER')
    }
  }

  schedules(): Schedule[] {
    return this.db
      .prepare('SELECT * FROM schedules ORDER BY time, kind')
      .all()
      .flatMap((row) =>
        isTaskKind(row.kind)
          ? [
              {
                id: String(row.id),
                kind: row.kind,
                days: json<number[]>(row.days, []),
                time: String(row.time),
                everyHours: typeof row.every_hours === 'number' ? row.every_hours : null,
                enabled: row.enabled === 1,
                mode: row.mode === 'real' ? ('real' as const) : ('prueba' as const),
                nextRunAt: typeof row.next_run_at === 'number' ? row.next_run_at : null,
                lastRunAt: typeof row.last_run_at === 'number' ? row.last_run_at : null
              }
            ]
          : []
      )
  }

  saveSchedule(schedule: Schedule): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO schedules (id, kind, days, time, enabled, mode, next_run_at, last_run_at, every_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        schedule.id,
        schedule.kind,
        JSON.stringify(schedule.days),
        schedule.time,
        schedule.enabled ? 1 : 0,
        schedule.mode,
        schedule.nextRunAt,
        schedule.lastRunAt,
        schedule.everyHours ?? null
      )
  }

  removeSchedule(id: string): void {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
  }

  startRun(scheduleId: string | null, kind: TaskKind, at: number): number {
    const result = this.db
      .prepare(
        "INSERT INTO schedule_runs (schedule_id, kind, started_at, ok, summary) VALUES (?, ?, ?, 0, 'En curso…')"
      )
      .run(scheduleId, kind, at)
    return Number(result.lastInsertRowid)
  }

  finishRun(id: number, ok: boolean, summary: string, at: number): void {
    this.db
      .prepare('UPDATE schedule_runs SET finished_at = ?, ok = ?, summary = ? WHERE id = ?')
      .run(at, ok ? 1 : 0, summary.slice(0, 2000), id)
  }

  /** Closes what a restart cut off: unfinished runs fail, orders in progress wait again. */
  recoverInterrupted(at: number): void {
    this.db
      .prepare(
        'UPDATE schedule_runs SET finished_at = ?, ok = 0, summary = ? WHERE finished_at IS NULL'
      )
      .run(at, 'Interrumpida: el plugin se reinició a media tarea')
    for (const order of this.orders('en_proceso')) {
      this.saveOrder({ ...order, status: 'pendiente', updatedAt: at })
    }
  }

  runs(limit = 30): ScheduleRun[] {
    return this.db
      .prepare('SELECT * FROM schedule_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit)
      .flatMap((row) =>
        isTaskKind(row.kind)
          ? [
              {
                id: Number(row.id),
                scheduleId: typeof row.schedule_id === 'string' ? row.schedule_id : null,
                kind: row.kind,
                startedAt: Number(row.started_at),
                finishedAt: typeof row.finished_at === 'number' ? row.finished_at : null,
                ok: row.ok === 1,
                summary: String(row.summary)
              }
            ]
          : []
      )
  }

  orders(status?: OrderStatus): PurchaseOrder[] {
    const rows = status
      ? this.db
          .prepare('SELECT data FROM purchase_orders WHERE status = ? ORDER BY created_at')
          .all(status)
      : this.db.prepare('SELECT data FROM purchase_orders ORDER BY created_at DESC LIMIT 100').all()
    return rows.flatMap((row) => {
      const order = json<PurchaseOrder | null>(row.data, null)
      return isRecord(order) && typeof order.id === 'string' ? [order] : []
    })
  }

  saveOrder(order: PurchaseOrder): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO purchase_orders (id, created_at, status, data, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(order.id, order.createdAt, order.status, JSON.stringify(order), order.updatedAt)
  }

  updateOrder(id: string, status: OrderStatus, results: OrderItemResult[], at: number): void {
    const order = this.orders().find((candidate) => candidate.id === id)
    if (order) {
      this.saveOrder({ ...order, status, results, updatedAt: at })
    }
  }
}
