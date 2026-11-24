import { assert, test } from 'orca/testing'
import type { CheckoutRequest, CheckoutResult } from './checkout-browser'
import { withStatus } from './catalog-status'
import type { Product } from './protocol'
import { processOrders, type OrderSource } from './purchase-runner'
import type { OrderAddress, OrderItemResult, OrderStatus, PurchaseOrder } from './schedule-types'

const ADDRESS: OrderAddress = {
  recipient: 'Ana López',
  phone: '3312345678',
  street: 'Av. Patria',
  number: '1200',
  interior: null,
  colonia: 'Jardines Universidad',
  postalCode: '45110',
  municipality: 'Zapopan',
  state: 'Jalisco',
  references: null
}

const product = (id: string, price: number | null, extra: Partial<Product> = {}): Product =>
  withStatus({
    id,
    name: id,
    brand: 'now',
    owner: 'acme',
    quantity: null,
    flavor: null,
    productURL: `https://meli.la/${id}`,
    linkKind: 'referido',
    sharedCount: 1,
    price,
    listPrice: null,
    discountPercentage: null,
    mlItemId: null,
    priceCheckedAt: null,
    hasStock: true,
    margin: null,
    reading:
      price === null
        ? null
        : {
            ok: true,
            checkedAt: 1,
            price,
            listPrice: null,
            discountPercentage: null,
            title: 'Now',
            seller: null,
            mlItemId: null
          },
    proposal: null,
    status: 'sin_revisar',
    diffPct: null,
    ...extra
  })

function queue(orders: PurchaseOrder[]) {
  const reports: { id: string; status: OrderStatus; results: OrderItemResult[] }[] = []
  const source: OrderSource = {
    pending: async () => orders,
    report: async (id, status, results) => {
      reports.push({ id, status, results: [...results] })
    }
  }
  return { source, reports }
}

const order = (items: PurchaseOrder['items'], cap: number): PurchaseOrder => ({
  id: 'o1',
  createdAt: 1,
  updatedAt: 1,
  status: 'pendiente',
  address: ADDRESS,
  items,
  cap,
  results: []
})

function checkout(answer: (request: CheckoutRequest) => CheckoutResult) {
  const requests: CheckoutRequest[] = []
  return {
    requests,
    client: {
      checkout: async (request: CheckoutRequest) => (requests.push(request), answer(request))
    }
  }
}

test('an order whose price went up is bought anyway, and the loss is recorded', async () => {
  const { source, reports } = queue([order([{ productId: 'v', quantity: 1 }], 523)])
  const browser = checkout(() => ({
    stage: 'comprado',
    total: 900,
    orderNumber: '2000016155355945',
    message: 'Compra confirmada'
  }))
  const run = await processOrders({
    source,
    products: new Map([['v', product('v', 900)]]),
    checkout: browser.client,
    mode: 'real'
  })
  assert.deepEqual(run, { processed: 1, bought: 1, review: 0, stopped: 0, loss: 377 })
  assert.equal(browser.requests[0]?.maxTotal, null, 'the cap is the price read when buying')
  const last = reports.at(-1)
  assert.equal(last?.status, 'comprado')
  const loss = last?.results.find((result) => result.stage === 'merma')
  assert.equal(loss?.total, 377)
  assert.match(loss?.message ?? '', /pagado \$900 · cobrado \$523/)
})

test('test mode walks every item to the review and buys nothing', async () => {
  const { source, reports } = queue([
    order(
      [
        { productId: 'c', quantity: 1 },
        { productId: 'd', quantity: 2 }
      ],
      2000
    )
  ])
  const browser = checkout((request) => ({
    stage: 'resumen',
    total: 300,
    orderNumber: null,
    message: `listo ${request.quantity}`,
    testPassed: true
  }))
  const run = await processOrders({
    source,
    products: new Map([
      ['c', product('c', 299)],
      ['d', product('d', 292)]
    ]),
    checkout: browser.client,
    mode: 'prueba'
  })
  assert.equal(run.review, 1)
  assert.deepEqual(
    browser.requests.map((r) => [r.referralUrl, r.quantity, r.mode]),
    [
      ['https://meli.la/c', 1, 'prueba'],
      ['https://meli.la/d', 2, 'prueba']
    ]
  )
  assert.equal(reports.at(-1)?.status, 'en_revision')
})

test('a real purchase stops at the first item that does not go through, and never spends past the cap', async () => {
  const { source, reports } = queue([
    order(
      [
        { productId: 'c', quantity: 1 },
        { productId: 'd', quantity: 1 }
      ],
      700
    )
  ])
  const browser = checkout((request) =>
    request.referralUrl.endsWith('/c')
      ? { stage: 'comprado', total: 299, orderNumber: '2000001234', message: 'Compra confirmada' }
      : { stage: 'pago', total: null, orderNumber: null, message: 'Falta elegir un medio de pago' }
  )
  const run = await processOrders({
    source,
    products: new Map([
      ['c', product('c', 299)],
      ['d', product('d', 292)]
    ]),
    checkout: browser.client,
    mode: 'real'
  })
  assert.equal(run.stopped, 1)
  assert.equal(browser.requests[1]?.maxTotal, null)
  const last = reports.at(-1)
  assert.equal(last?.status, 'detenido')
  assert.deepEqual(
    last?.results.map((r) => r.orderNumber),
    ['2000001234', null]
  )
})

test('a product whose link is known to be broken stops the order', async () => {
  const { source } = queue([order([{ productId: 'r', quantity: 1 }], 9999)])
  const browser = checkout(() => ({ stage: 'resumen', total: 1, orderNumber: null, message: '' }))
  const broken = withStatus({
    ...product('r', 299),
    reading: {
      ok: false,
      checkedAt: 1,
      price: null,
      listPrice: null,
      discountPercentage: null,
      title: null,
      seller: null,
      mlItemId: null
    }
  })
  const run = await processOrders({
    source,
    products: new Map([['r', broken]]),
    checkout: browser.client,
    mode: 'real'
  })
  assert.equal(run.stopped, 1)
  assert.equal(browser.requests.length, 0)
})

test('a test checkout that stops ready on purpose counts as ready for review', async () => {
  const { source, reports } = queue([order([{ productId: 'c', quantity: 1 }], 2000)])
  const browser = checkout(() => ({
    stage: 'domicilio',
    total: null,
    orderNumber: null,
    message: 'Domicilio llenado',
    testPassed: true
  }))
  const run = await processOrders({
    source,
    products: new Map([['c', product('c', 299)]]),
    checkout: browser.client,
    mode: 'prueba'
  })
  assert.equal(run.review, 1)
  assert.equal(reports.at(-1)?.status, 'en_revision')
})

test('a test checkout stopped by the cap is stopped, not ready for review', async () => {
  const { source, reports } = queue([order([{ productId: 'c', quantity: 1 }], 400)])
  const browser = checkout(() => ({
    stage: 'resumen',
    total: 450,
    orderNumber: null,
    message: 'El total $450 supera el tope $400'
  }))
  const run = await processOrders({
    source,
    products: new Map([['c', product('c', 299)]]),
    checkout: browser.client,
    mode: 'prueba'
  })
  assert.equal(run.stopped, 1)
  assert.equal(reports.at(-1)?.status, 'detenido')
})
