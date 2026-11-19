// Runs due scheduled tasks one at a time, every minute while the plugin is enabled (its status
// bar item keeps the worker alive). A task missed while Topo was closed runs once on start.
import { nextRunAt } from './schedule-time'
import type { ScheduleStore } from './schedule-store'
import type { PurchaseMode, Schedule, TaskKind } from './schedule-types'
import type { TaskOutcome } from './task-runner'

export type Scheduler = {
  tick(): Promise<void>
  runNow(kind: TaskKind, mode: PurchaseMode, scheduleId: string | null): Promise<TaskOutcome>
  stop(): void
}

export function startScheduler(options: {
  store: ScheduleStore
  run(kind: TaskKind, mode: PurchaseMode): Promise<TaskOutcome>
  changed(): void
  notify(title: string, body: string): void
  now?: () => number
  everyMs?: number
}): Scheduler {
  const now = options.now ?? Date.now
  let busy: Promise<unknown> = Promise.resolve()
  // Nothing runs yet in this process, so anything still open was cut off by a restart.
  options.store.recoverInterrupted(now())

  const execute = (kind: TaskKind, mode: PurchaseMode, scheduleId: string | null) => {
    const job = busy.then(async (): Promise<TaskOutcome> => {
      const runId = options.store.startRun(scheduleId, kind, now())
      options.changed()
      let outcome: TaskOutcome
      try {
        outcome = await options.run(kind, mode)
      } catch (error) {
        outcome = { ok: false, summary: error instanceof Error ? error.message : String(error) }
      }
      options.store.finishRun(runId, outcome.ok, outcome.summary, now())
      options.changed()
      if (!outcome.ok || kind === 'processOrders') {
        options.notify(outcome.ok ? 'Tarea terminada' : 'Tarea con problemas', outcome.summary)
      }
      return outcome
    })
    busy = job.catch(() => undefined)
    return job
  }

  const advance = (schedule: Schedule, at: number) => {
    options.store.saveSchedule({
      ...schedule,
      lastRunAt: at,
      nextRunAt: nextRunAt(schedule.days, schedule.time, at)
    })
  }

  const tick = async () => {
    const at = now()
    for (const schedule of options.store.schedules()) {
      if (schedule.enabled && schedule.nextRunAt !== null && schedule.nextRunAt <= at) {
        // Advance first: a slow or failing task never runs twice for one due time.
        advance(schedule, at)
        await execute(schedule.kind, schedule.mode, schedule.id)
      }
    }
  }

  const timer = setInterval(() => void tick(), options.everyMs ?? 60_000)
  // Never the reason a process stays up (tests, a worker shutting down).
  timer.unref?.()
  void tick()
  return {
    tick,
    runNow: (kind, mode, scheduleId) => execute(kind, mode, scheduleId),
    stop: () => clearInterval(timer)
  }
}
