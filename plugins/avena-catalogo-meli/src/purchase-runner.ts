// Processes pending purchase orders: checks each against its cap with the prices read, buys item
// by item through the referrals, and reports what happened to the order source.
import type { CheckoutClient } from './checkout-browser'
import type { Product } from './protocol'
import type { OrderItemResult, OrderStatus, PurchaseMode, PurchaseOrder } from './schedule-types'

export type OrderSource = {
  pending(): Promise<PurchaseOrder[]>
  report(id: string, status: OrderStatus, results: OrderItemResult[]): Promise<void>
}

export type RunSummary = { processed: number; bought: number; review: number; stopped: number }

export async function processOrders(options: {
  source: OrderSource
  products: ReadonlyMap<string, Product>
  checkout: CheckoutClient
  mode: PurchaseMode
}): Promise<RunSummary> {
  const summary: RunSummary = { processed: 0, bought: 0, review: 0, stopped: 0 }
  for (const order of await options.source.pending()) {
    summary.processed++
    const status = await processOrder(order, options)
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
): Promise<OrderStatus> {
  const results: OrderItemResult[] = []
  const stopAll = async (message: string): Promise<OrderStatus> => {
    results.push({ productId: '', stage: 'validacion', total: null, orderNumber: null, message })
    await source.report(order.id, 'detenido', results)
    return 'detenido'
  }
  let estimate = 0
  for (const item of order.items) {
    const product = products.get(item.productId)
    if (!product || product.linkKind !== 'referido') {
      return stopAll(`${product?.name ?? item.productId}: no tiene link de referido`)
    }
    if (!product.reading?.ok || product.reading.price === null) {
      return stopAll(`${product.name}: sin precio leído en MercadoLibre (link roto o sin leer)`)
    }
    estimate += product.reading.price * item.quantity
  }
  if (estimate > order.cap) {
    return stopAll(`El total estimado $${estimate.toFixed(2)} supera el tope $${order.cap}`)
  }
  await source.report(order.id, 'en_proceso', results)
  let remaining = order.cap
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
        maxTotal: remaining
      })
      .catch((error: unknown) => ({
        stage: 'error',
        total: null,
        orderNumber: null,
        message: error instanceof Error ? error.message : String(error)
      }))
    results.push({ productId: product.id, ...result })
    if (result.stage === 'comprado') {
      remaining -= result.total ?? 0
    } else if (!(mode === 'prueba' && result.stage === 'resumen')) {
      await source.report(order.id, 'detenido', results)
      return 'detenido'
    }
  }
  const status: OrderStatus = mode === 'real' ? 'comprado' : 'en_revision'
  await source.report(order.id, status, results)
  return status
}
