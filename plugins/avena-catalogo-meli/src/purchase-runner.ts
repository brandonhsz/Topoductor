// Processes pending purchase orders: buys item by item through the referrals at the price the page
// shows (Avena absorbs rises), records the loss and reports what happened to the order source.
import type { CheckoutClient, CheckoutResult } from './checkout-browser'
import type { Product } from './protocol'
import type { OrderItemResult, OrderStatus, PurchaseMode, PurchaseOrder } from './schedule-types'

export type OrderSource = {
  pending(): Promise<PurchaseOrder[]>
  report(id: string, status: OrderStatus, results: OrderItemResult[]): Promise<void>
}

export type RunSummary = {
  processed: number
  bought: number
  review: number
  stopped: number
  /** What Avena absorbed: paid in MercadoLibre over what the patients were charged. */
  loss: number
}

const money = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2))

function lossOf(paid: number, charged: number): number {
  return paid > 0 ? Math.max(0, Math.round((paid - charged) * 100) / 100) : 0
}

export async function processOrders(options: {
  source: OrderSource
  products: ReadonlyMap<string, Product>
  checkout: CheckoutClient
  mode: PurchaseMode
}): Promise<RunSummary> {
  const summary: RunSummary = { processed: 0, bought: 0, review: 0, stopped: 0, loss: 0 }
  for (const order of await options.source.pending()) {
    summary.processed++
    const { status, loss } = await processOrder(order, options)
    summary.loss = Math.round((summary.loss + loss) * 100) / 100
    if (status === 'comprado') {
      summary.bought++
    } else if (status === 'en_revision') {
      summary.review++
    } else {
      summary.stopped++
    }
  }
  return summary
}

async function processOrder(
  order: PurchaseOrder,
  {
    source,
    products,
    checkout,
    mode
  }: {
    source: OrderSource
    products: ReadonlyMap<string, Product>
    checkout: CheckoutClient
    mode: PurchaseMode
  }
): Promise<{ status: OrderStatus; loss: number }> {
  const results: OrderItemResult[] = []
  const stopAll = async (message: string) => {
    results.push({ productId: '', stage: 'validacion', total: null, orderNumber: null, message })
    await source.report(order.id, 'detenido', results)
    return { status: 'detenido' as const, loss: 0 }
  }
  for (const item of order.items) {
    const product = products.get(item.productId)
    if (!product || product.linkKind !== 'referido') {
      return stopAll(`${product?.name ?? item.productId}: no tiene link de referido`)
    }
    if (product.reading?.ok === false) {
      return stopAll(`${product.name}: el link de referido está roto`)
    }
  }
  await source.report(order.id, 'en_proceso', results)
  let paid = 0
  for (const item of order.items) {
    const product = products.get(item.productId)
    if (!product) {
      continue
    }
    const result = await checkout
      .checkout({
        referralUrl: product.productURL,
        quantity: item.quantity,
        address: order.address,
        mode,
        // Avena absorbs price rises: the cap is the price the page shows when buying.
        maxTotal: null
      })
      .catch((error: unknown): CheckoutResult => ({
        stage: 'error',
        total: null,
        orderNumber: null,
        message: error instanceof Error ? error.message : String(error)
      }))
    results.push({ productId: product.id, ...result })
    if (result.stage === 'comprado') {
      paid += result.total ?? 0
    } else if (mode === 'prueba' && result.testPassed === true) {
      paid += result.total ?? 0
    } else if (!(mode === 'prueba' && result.testPassed === true)) {
      await source.report(order.id, 'detenido', results)
      return { status: 'detenido', loss: 0 }
    }
  }
  const status: OrderStatus = mode === 'real' ? 'comprado' : 'en_revision'
  const loss = lossOf(paid, order.cap)
  if (loss > 0) {
    results.push({
      productId: '',
      stage: 'merma',
      total: loss,
      orderNumber: null,
      message: `${mode === 'real' ? 'Merma' : 'Merma estimada'} $${money(loss)} (pagado $${money(paid)} · cobrado $${money(order.cap)})`
    })
  }
  await source.report(order.id, status, results)
  return { status, loss }
}
