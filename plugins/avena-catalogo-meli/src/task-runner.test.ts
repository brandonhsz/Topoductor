import { assert, test } from 'orca/testing'
import { createTaskRunner } from './task-runner'

test('updating prices reads every link first, then writes the changes it found', async () => {
  const calls: [string, unknown][] = []
  const run = createTaskRunner({
    call: async (name, input) => {
      calls.push([name, input])
      if (name === 'catalog.ids') {
        return ['vitatu', 'omega']
      }
      return {
        ok: true,
        message: name === 'catalog.applyPrices' ? '2 precio(s) guardado(s) en la base.' : 'Leyendo…'
      }
    },
    bus: { next: async () => ({ running: false, done: 415, total: 415, blocked: false }) },
    processOrders: async () => ({ processed: 0, bought: 0, review: 0, stopped: 0, loss: 0 })
  })
  const outcome = await run('updatePrices', 'prueba')
  assert.deepEqual(
    calls.map(([name]) => name),
    ['catalog.audit', 'catalog.ids', 'catalog.applyPrices']
  )
  assert.deepEqual(calls[1]?.[1], { scope: 'priceUpdates' })
  assert.deepEqual(calls[2]?.[1], { ids: ['vitatu', 'omega'] })
  assert.equal(outcome.ok, true)
  assert.match(outcome.summary, /415\/415 links leídos · 2 precio/)
})

test('a blocked read applies nothing', async () => {
  const calls: string[] = []
  const run = createTaskRunner({
    call: async (name) => (calls.push(name), { ok: true, message: '' }),
    bus: { next: async () => ({ running: false, done: 24, total: 415, blocked: true }) },
    processOrders: async () => ({ processed: 0, bought: 0, review: 0, stopped: 0, loss: 0 })
  })
  const outcome = await run('updatePrices', 'prueba')
  assert.deepEqual(calls, ['catalog.audit'])
  assert.equal(outcome.ok, false)
})
