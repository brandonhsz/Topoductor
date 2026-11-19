// One MercadoLibre purchase of one product, step by step in Topo's browser. Every step reads the
// page first and stops with the step it reached when anything is not as expected.
import {
  addressFormExpression,
  BUY_NOW_EXPRESSION,
  CHECKOUT_STATE_EXPRESSION,
  CONFIRM_EXPRESSION,
  CONTINUE_EXPRESSION,
  FEATURED_PRODUCT_EXPRESSION,
  quantityExpression,
  SAVE_ADDRESS_EXPRESSION
} from './checkout-scripts'
import { amount, field, text } from './json-fields'
import type { MeliBrowser } from './meli-browser'
import type { OrderAddress, PurchaseMode } from './schedule-types'

export type CheckoutRequest = {
  referralUrl: string
  quantity: number
  address: OrderAddress
  mode: PurchaseMode
  /** Most this purchase may cost; a higher total is never confirmed. */
  maxTotal: number
}

export type CheckoutResult = {
  stage: string
  total: number | null
  orderNumber: string | null
  message: string
}

export type CheckoutClient = { checkout(request: CheckoutRequest): Promise<CheckoutResult> }

const MAX_STEPS = 8

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether the review page names the order's postal code and street. */
export function showsAddress(pageText: string, address: OrderAddress): boolean {
  const page = normalize(pageText)
  return page.includes(normalize(address.postalCode)) && page.includes(normalize(address.street))
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class CheckoutBrowser implements CheckoutClient {
  constructor(private readonly browser: MeliBrowser) {}

  private async step(pageId: string, expression: string): Promise<unknown> {
    return this.browser.evaluate(pageId, expression, 60_000)
  }

  private async goto(pageId: string, url: string): Promise<void> {
    await this.browser.run(['goto', '--page', pageId, '--url', url], 45_000)
    await this.browser
      .run(['wait', '--page', pageId, '--load', 'load'], 30_000)
      .catch(() => undefined)
  }

  async checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    const stop = (stage: string, message: string, total: number | null = null): CheckoutResult => ({
      stage,
      total,
      orderNumber: null,
      message
    })
    const { browserPageId: page } = await this.browser.findTab()
    // Through the referral, so the purchase carries the affiliate parameters.
    await this.goto(page, request.referralUrl)
    await this.browser
      .run(['wait', '--page', page, '--selector', '.rl-card-featured'], 25_000)
      .catch(() => undefined)
    const productUrl = text(field(await this.step(page, FEATURED_PRODUCT_EXPRESSION), 'url'))
    if (!productUrl) {
      return stop('referido', 'El referido no muestra el producto (link roto)')
    }
    await this.goto(page, productUrl)
    for (const expression of [quantityExpression(request.quantity), BUY_NOW_EXPRESSION]) {
      const done = await this.step(page, expression)
      if (field(done, 'ok') !== true) {
        return stop('producto', text(field(done, 'message')) ?? 'No se pudo preparar la compra')
      }
    }
    await pause(5000)
    let addressDone = false
    for (let index = 0; index < MAX_STEPS; index++) {
      const state = await this.step(page, CHECKOUT_STATE_EXPRESSION)
      const step = text(field(state, 'step')) ?? 'desconocido'
      const total = amount(field(state, 'total'))
      if (step === 'comprado') {
        return {
          stage: 'comprado',
          total,
          orderNumber: text(field(state, 'orderNumber')),
          message: 'Compra confirmada'
        }
      }
      if (step === 'verificacion') {
        return stop(step, 'MercadoLibre pidió verificación de la cuenta')
      }
      if (step === 'pago') {
        return stop(step, 'Falta elegir o guardar un medio de pago en la cuenta')
      }
      if (step === 'domicilio') {
        if (addressDone) {
          return stop(step, 'MercadoLibre no aceptó el domicilio')
        }
        const filled = await this.step(page, addressFormExpression(request.address))
        if (field(filled, 'ok') !== true) {
          return stop(step, text(field(filled, 'message')) ?? 'No se pudo llenar el domicilio')
        }
        if (request.mode === 'prueba') {
          return stop(step, 'Domicilio llenado (modo prueba: no se guardó en la cuenta)')
        }
        await this.step(page, SAVE_ADDRESS_EXPRESSION)
        addressDone = true
      } else if (step === 'resumen') {
        if (total === null) {
          return stop(step, 'No se pudo leer el total del resumen')
        }
        // A saved address of the account would skip the form: never confirm another address.
        if (!showsAddress(text(field(state, 'text')) ?? '', request.address)) {
          return stop(step, 'El resumen no muestra el domicilio del pedido', total)
        }
        if (total > request.maxTotal) {
          return stop(step, `El total $${total} supera el tope $${request.maxTotal}`, total)
        }
        if (request.mode === 'prueba') {
          return stop(
            'resumen',
            `Listo para confirmar por $${total} (modo prueba: no se compró)`,
            total
          )
        }
        await this.step(page, CONFIRM_EXPRESSION)
      } else if (step === 'continuar') {
        await this.step(page, CONTINUE_EXPRESSION)
      } else {
        return stop(step, `Paso del checkout no reconocido (${text(field(state, 'path')) ?? ''})`)
      }
      await pause(5000)
    }
    return stop('checkout', 'El checkout no terminó en los pasos esperados')
  }
}
