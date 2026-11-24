import { assert, test } from 'orca/testing'
import { ScheduleStore } from './schedule-store'
import { startScheduler } from './scheduler'

test('a due task runs once, moves to its next time and is recorded', async () => {
  const store = new ScheduleStore(':memory:')
  let clock = new Date(2026, 10, 18, 9, 31).getTime()
  store.saveSchedule({
    id: 'a',
    kind: 'audit',
    days: [3],
    time: '09:30',
    enabled: true,
    mode: 'prueba',
    nextRunAt: new Date(2026, 10, 18, 9, 30).getTime(),
    lastRunAt: null
  })
  const ran: string[] = []
  const notes: string[] = []
  const scheduler = startScheduler({
    store,
    run: async (kind) => {
      ran.push(kind)
      return { ok: false, summary: 'MercadoLibre pidió verificación' }
    },
    changed: () => undefined,
    notify: (title, body) => notes.push(`${title}: ${body}`),
    now: () => clock,
    everyMs: 3_600_000
  })
  await scheduler.tick()
  await scheduler.tick()
  scheduler.stop()
  assert.deepEqual(ran, ['audit'])
  const [schedule] = store.schedules()
  assert.equal(schedule?.nextRunAt, new Date(2026, 10, 25, 9, 30).getTime())
  assert.equal(store.runs()[0]?.ok, false)
  assert.deepEqual(notes, ['Tarea con problemas: MercadoLibre pidió verificación'])
  clock += 1
})

test('a paused task never runs', async () => {
  const store = new ScheduleStore(':memory:')
  store.saveSchedule({
    id: 'b',
    kind: 'sync',
    days: [0, 1, 2, 3, 4, 5, 6],
    time: '00:00',
    enabled: false,
    mode: 'prueba',
    nextRunAt: 1,
    lastRunAt: null
  })
  const ran: string[] = []
  const scheduler = startScheduler({
    store,
    run: async (kind) => (ran.push(kind), { ok: true, summary: '' }),
    changed: () => undefined,
    notify: () => undefined,
    everyMs: 3_600_000
  })
  await scheduler.tick()
  scheduler.stop()
  assert.deepEqual(ran, [])
})

test('a run cut off by a restart is closed and its order goes back to pending', async () => {
  const store = new ScheduleStore(':memory:')
  store.startRun(null, 'processOrders', 1)
  store.saveOrder({
    id: 'o1',
    createdAt: 1,
    updatedAt: 1,
    status: 'en_proceso',
    address: {
      recipient: 'Prueba',
      phone: '1',
      street: 'Calle',
      number: '1',
      interior: null,
      colonia: 'Centro',
      postalCode: '45110',
      municipality: 'Zapopan',
      state: 'Jalisco',
      references: null
    },
    items: [{ productId: 'c', quantity: 1 }],
    cap: 400,
    results: []
  })
  const scheduler = startScheduler({
    store,
    run: async () => ({ ok: true, summary: '' }),
    changed: () => undefined,
    notify: () => undefined,
    now: () => 50,
    everyMs: 3_600_000
  })
  scheduler.stop()
  const [run] = store.runs()
  assert.equal(run?.finishedAt, 50)
  assert.equal(run?.ok, false)
  assert.match(run?.summary ?? '', /Interrumpida/)
  assert.equal(store.orders()[0]?.status, 'pendiente')
})

test('a task repeating every 3 hours moves to its next slot after running', async () => {
  const store = new ScheduleStore(':memory:')
  const clock = new Date(2026, 10, 19, 12, 1).getTime()
  store.saveSchedule({
    id: 'p',
    kind: 'updatePrices',
    days: [0, 1, 2, 3, 4, 5, 6],
    time: '00:00',
    everyHours: 3,
    enabled: true,
    mode: 'prueba',
    nextRunAt: new Date(2026, 10, 19, 12).getTime(),
    lastRunAt: null
  })
  const scheduler = startScheduler({
    store,
    run: async () => ({ ok: true, summary: '' }),
    changed: () => undefined,
    notify: () => undefined,
    now: () => clock,
    everyMs: 3_600_000
  })
  await scheduler.tick()
  scheduler.stop()
  assert.equal(store.schedules()[0]?.nextRunAt, new Date(2026, 10, 19, 15).getTime())
  assert.equal(store.schedules()[0]?.everyHours, 3)
})
