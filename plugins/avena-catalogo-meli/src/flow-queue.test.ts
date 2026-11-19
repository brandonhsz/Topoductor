import { assert, test } from 'orca/testing'
import { FlowQueue, SqliteFlowLock } from './flow-queue'

const later = () => {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('flows of one worker run one at a time, in arrival order', async () => {
  const lock = new SqliteFlowLock(':memory:')
  const queue = new FlowQueue(async () => lock, { owner: 'a', pollMs: 1 })
  const order: string[] = []
  const first = later()
  const a = queue.run('Leer precios', async () => {
    order.push('a:start')
    await first.gate
    order.push('a:end')
  })
  const b = queue.run('Compra', async () => {
    order.push('b')
  })
  await tick()
  assert.deepEqual(queue.state(), { running: 'Leer precios', waiting: ['Compra'], elsewhere: null })
  first.open()
  await Promise.all([a, b])
  assert.deepEqual(order, ['a:start', 'a:end', 'b'])
  assert.deepEqual(queue.state(), { running: null, waiting: [], elsewhere: null })
})

test('another worker waits until the flow in progress ends', async () => {
  const lock = new SqliteFlowLock(':memory:')
  const one = new FlowQueue(async () => lock, { owner: 'one', pollMs: 1 })
  const two = new FlowQueue(async () => lock, { owner: 'two', pollMs: 1 })
  const first = later()
  const order: string[] = []
  const a = one.run('Compra', async () => {
    await first.gate
    order.push('one')
  })
  await tick()
  const b = two.run('Generar referidos', async () => {
    order.push('two')
  })
  await tick()
  assert.deepEqual(order, [])
  assert.equal(two.state().elsewhere, 'Compra')
  first.open()
  await Promise.all([a, b])
  assert.deepEqual(order, ['one', 'two'])
})

test('a flow left by a worker that died is taken over once its lease goes stale', async () => {
  const lock = new SqliteFlowLock(':memory:')
  assert.deepEqual(lock.tryAcquire('dead', 'Compra', 0, 1000), { ok: true })
  let clock = 500
  const queue = new FlowQueue(async () => lock, {
    owner: 'alive',
    pollMs: 1,
    staleMs: 1000,
    now: () => clock
  })
  let ran = false
  const run = queue.run('Leer precios', async () => {
    ran = true
  })
  await tick()
  assert.equal(ran, false)
  clock = 2000
  await run
  assert.equal(ran, true)
})

test('a failing flow frees the queue for the next one', async () => {
  const lock = new SqliteFlowLock(':memory:')
  const queue = new FlowQueue(async () => lock, { owner: 'a', pollMs: 1 })
  await queue
    .run('Falla', async () => {
      throw new Error('x')
    })
    .catch(() => undefined)
  assert.equal(await queue.run('Sigue', async () => 'ok'), 'ok')
})

test('every MercadoLibre call waits for the flow in progress', async () => {
  const { queuedMeli } = await import('./meli-queue')
  const lock = new SqliteFlowLock(':memory:')
  const queue = new FlowQueue(async () => lock, { owner: 'a', pollMs: 1 })
  const first = later()
  const order: string[] = []
  const purchase = queue.run('Procesar pedidos', async () => {
    await first.gate
    order.push('compra')
  })
  const meli = queuedMeli(
    {
      readCards: async () => undefined,
      generateReferrals: async () => [],
      canonicalUrl: async () => ({ status: 200, canonical: null, unavailable: false }),
      search: async () => {
        order.push('busqueda')
        return []
      }
    },
    queue
  )
  const search = meli.search('now')
  await tick()
  assert.deepEqual(queue.state().waiting, ['Buscar en MercadoLibre'])
  first.open()
  await Promise.all([purchase, search])
  assert.deepEqual(order, ['compra', 'busqueda'])
})
