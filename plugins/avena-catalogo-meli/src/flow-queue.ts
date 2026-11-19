// One MercadoLibre flow at a time. Flows share one browser tab and one account, so a second flow
// waits its turn: in this worker through a FIFO chain, and across workers (a restarted or second
// worker) through a lease in the plugin's SQLite file that the holder keeps fresh.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Acquired = { ok: true } | { ok: false; holder: string }

export type LockStore = {
  tryAcquire(owner: string, label: string, now: number, staleMs: number): Acquired
  heartbeat(owner: string, now: number): void
  release(owner: string): void
}

export class SqliteFlowLock implements LockStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true })
    }
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS flow_lock (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, label TEXT NOT NULL, heartbeat_at INTEGER NOT NULL)'
    )
  }

  tryAcquire(owner: string, label: string, now: number, staleMs: number): Acquired {
    // IMMEDIATE takes the write lock first, so two workers cannot both see the lease free.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db
        .prepare('SELECT owner, label, heartbeat_at FROM flow_lock WHERE id = 1')
        .get()
      const free = !row || row.owner === owner || Number(row.heartbeat_at) < now - staleMs
      if (free) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO flow_lock (id, owner, label, heartbeat_at) VALUES (1, ?, ?, ?)'
          )
          .run(owner, label, now)
      }
      this.db.exec('COMMIT')
      return free ? { ok: true } : { ok: false, holder: String(row?.label ?? '') }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  heartbeat(owner: string, now: number): void {
    this.db.prepare('UPDATE flow_lock SET heartbeat_at = ? WHERE owner = ?').run(now, owner)
  }

  release(owner: string): void {
    this.db.prepare('DELETE FROM flow_lock WHERE owner = ?').run(owner)
  }
}

export type QueueState = {
  /** The flow this worker is running. */
  running: string | null
  /** Flows of this worker waiting their turn, in order. */
  waiting: string[]
  /** A flow another worker holds, while this one waits for it. */
  elsewhere: string | null
}

export type FlowQueueOptions = {
  owner?: string
  pollMs?: number
  /** A lease not refreshed for this long belongs to a worker that died. */
  staleMs?: number
  now?: () => number
  changed?(state: QueueState): void
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class FlowQueue {
  private readonly owner: string
  private readonly pollMs: number
  private readonly staleMs: number
  private readonly now: () => number
  private tail: Promise<unknown> = Promise.resolve()
  private current: QueueState = { running: null, waiting: [], elsewhere: null }

  constructor(
    private readonly lock: () => Promise<LockStore>,
    private readonly options: FlowQueueOptions = {}
  ) {
    this.owner = options.owner ?? randomUUID()
    this.pollMs = options.pollMs ?? 2000
    this.staleMs = options.staleMs ?? 120_000
    this.now = options.now ?? Date.now
  }

  state(): QueueState {
    return { ...this.current, waiting: [...this.current.waiting] }
  }

  private update(change: Partial<QueueState>): void {
    this.current = { ...this.current, ...change }
    this.options.changed?.(this.state())
  }

  /** Runs `flow` once every flow before it, here or in another worker, has ended. */
  run<T>(label: string, flow: () => Promise<T>): Promise<T> {
    this.update({ waiting: [...this.current.waiting, label] })
    const turn = this.tail.then(async () => {
      const store = await this.lock()
      for (;;) {
        const acquired = store.tryAcquire(this.owner, label, this.now(), this.staleMs)
        if (acquired.ok) {
          break
        }
        if (this.current.elsewhere !== acquired.holder) {
          this.update({ elsewhere: acquired.holder })
        }
        await pause(this.pollMs)
      }
      const index = this.current.waiting.indexOf(label)
      this.update({
        running: label,
        elsewhere: null,
        waiting: this.current.waiting.filter((_, position) => position !== index)
      })
      const beat = setInterval(
        () => store.heartbeat(this.owner, this.now()),
        Math.max(1000, this.staleMs / 3)
      )
      beat.unref?.()
      try {
        return await flow()
      } finally {
        clearInterval(beat)
        store.release(this.owner)
        this.update({ running: null })
      }
    })
    this.tail = turn.catch(() => undefined)
    return turn
  }
}
