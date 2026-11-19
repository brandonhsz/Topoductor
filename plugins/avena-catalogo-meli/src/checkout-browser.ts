// One MercadoLibre purchase of one product, step by step in Topo's browser. Every step reads the
// page first and stops with the step it reached when anything is not as expected.
import {
  ADD_TO_CART_EXPRESSION,
  BUY_NOW_EXPRESSION,
  CART_CLEAR_EXPRESSION,
  CART_CONTINUE_EXPRESSION,
  CART_URL,
  FEATURED_PRODUCT_EXPRESSION,
  isVerificationPath,
  PAGE_PATH_EXPRESSION,
  PRODUCT_ACTIONS_EXPRESSION,
  quantityExpression
} from './checkout-scripts'
import { walkCheckout } from './checkout-steps'
import { amount, field, text } from './json-fields'
import type { MeliBrowser, Tab } from './meli-browser'
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
  /** Test mode stopped where it should: everything up to buying worked. */
  testPassed?: boolean
}

export type CheckoutClient = { checkout(request: CheckoutRequest): Promise<CheckoutResult> }

export { showsAddress } from './checkout-steps'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type CheckoutOptions = {
  /** How long to wait for a person to solve a captcha before giving up. */
  waitMs?: number
  pollMs?: number
  /** Pause between checkout steps, so pages settle. */
  stepPauseMs?: number
  /** Called once per captcha, so someone hears about it while the tab waits in front. */
  onVerification?(message: string): void
}

export class CheckoutBrowser implements CheckoutClient {
  private readonly waitMs: number
  private readonly pollMs: number
  private readonly stepPauseMs: number

  constructor(
    private readonly browser: MeliBrowser,
    private readonly options: CheckoutOptions = {}
  ) {
    this.waitMs = options.waitMs ?? 15 * 60_000
    this.pollMs = options.pollMs ?? 3000
    this.stepPauseMs = options.stepPauseMs ?? 5000
  }

  private async path(pageId: string): Promise<string> {
    return text(field(await this.step(pageId, PAGE_PATH_EXPRESSION), 'path')) ?? ''
  }

  /**
   * When MercadoLibre shows a captcha, brings its tab to the front and waits for a person to solve
   * it. Nothing here ever answers the captcha. `false` when nobody solved it in time.
   */
  private async passVerification(tab: Tab, context: string): Promise<boolean> {
    const pageId = tab.browserPageId
    if (!isVerificationPath(await this.path(pageId))) {
      return true
    }
    // The tab may live in another workspace than the one on screen: open that one first.
    const worktree = tab.worktreeId ? ['--worktree', `id:${tab.worktreeId}`] : []
    if (tab.worktreeId) {
      await this.browser.run(['worktree', 'activate', ...worktree], 15_000).catch(() => undefined)
    }
    await this.browser
      .run(['tab', 'switch', '--page', pageId, ...worktree, '--focus'], 15_000)
      .catch(() => undefined)
    this.options.onVerification?.(
      `MercadoLibre pidió un captcha ${context}. Resuélvelo en el navegador de Topo: la compra sigue sola.`
    )
    const deadline = Date.now() + this.waitMs
    while (Date.now() < deadline) {
      await pause(this.pollMs)
      if (!isVerificationPath(await this.path(pageId).catch(() => '/captcha'))) {
        await pause(this.stepPauseMs)
        return true
      }
    }
    return false
  }

  private async step(pageId: string, expression: string): Promise<unknown> {
    return this.browser.evaluate(pageId, expression, 60_000)
  }

  private async goto(pageId: string, url: string): Promise<void> {
    await this.browser.run(['goto', '--page', pageId, '--url', url], 45_000)
    await this.browser
      .run(['wait', '--page', pageId, '--load', 'load'], 30_000)
      .catch(() => undefined)
  }

  /**
   * From the product page into the checkout: «Comprar ahora» when the listing has it, otherwise
   * the cart, but only an empty one, so other products in it are never bought along.
   * `null` when the checkout is open; a result when the purchase stops here.
   */
  private async startPurchase(
    page: string,
    request: CheckoutRequest
  ): Promise<{ stopped: CheckoutResult | null; viaCart: boolean }> {
    const stop = (message: string, stage = 'producto') => ({
      stopped: { stage, total: null, orderNumber: null, message },
      viaCart: false
    })
    const quantity = await this.step(page, quantityExpression(request.quantity))
    if (field(quantity, 'ok') !== true) {
      return stop(text(field(quantity, 'message')) ?? 'No se pudo elegir la cantidad')
    }
    const actions = await this.step(page, PRODUCT_ACTIONS_EXPRESSION)
    if (field(actions, 'buyNow') === true) {
      const bought = await this.step(page, BUY_NOW_EXPRESSION)
      return field(bought, 'ok') === true
        ? { stopped: null, viaCart: false }
        : stop(text(field(bought, 'message')) ?? 'No se pudo usar «Comprar ahora»')
    }
    if (field(actions, 'addToCart') !== true) {
      return stop(
        'La publicación no tiene «Comprar ahora» ni «Agregar al carrito» (sin stock o pausada)'
      )
    }
    const inCart = amount(field(actions, 'cartCount')) ?? 0
    if (inCart > 0) {
      return stop(
        `Solo se vende por carrito y el carrito de la cuenta tiene ${inCart} productos: vacíalo para que no se compren junto con el pedido`,
        'carrito'
      )
    }
    const added = await this.step(page, ADD_TO_CART_EXPRESSION)
    if (field(added, 'ok') !== true) {
      return stop(text(field(added, 'message')) ?? 'No se pudo agregar al carrito')
    }
    await pause(this.stepPauseMs)
    await this.goto(page, CART_URL)
    const next = await this.step(page, CART_CONTINUE_EXPRESSION)
    return field(next, 'ok') === true
      ? { stopped: null, viaCart: true }
      : stop(text(field(next, 'message')) ?? 'No se pudo continuar desde el carrito', 'carrito')
  }

  async checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    const stop = (stage: string, message: string, total: number | null = null): CheckoutResult => ({
      stage,
      total,
      orderNumber: null,
      message
    })
    const tab = await this.browser.findTab()
    const page = tab.browserPageId
    const unsolved = () =>
      stop(
        'verificacion',
        `MercadoLibre pidió un captcha y nadie lo resolvió en ${Math.round(this.waitMs / 60_000)} min`
      )
    // Through the referral, so the purchase carries the affiliate parameters.
    await this.goto(page, request.referralUrl)
    await this.browser
      .run(['wait', '--page', page, '--selector', '.rl-card-featured'], 25_000)
      .catch(() => undefined)
    if (!(await this.passVerification(tab, 'al abrir el referido'))) {
      return unsolved()
    }
    const productUrl = text(field(await this.step(page, FEATURED_PRODUCT_EXPRESSION), 'url'))
    if (!productUrl) {
      return stop('referido', 'El referido no muestra el producto (link roto)')
    }
    await this.goto(page, productUrl)
    if (!(await this.passVerification(tab, 'al abrir el producto'))) {
      return unsolved()
    }
    const started = await this.startPurchase(page, request)
    if (started.stopped) {
      return started.stopped
    }
    await pause(this.stepPauseMs)
    const result = await walkCheckout({
      request,
      step: (expression) => this.step(page, expression),
      pause: async () => {
        await pause(this.stepPauseMs)
      },
      passVerification: () => this.passVerification(tab, 'durante el pago')
    })
    // The cart was empty before: whatever is in it now is this purchase's, and it never stays.
    if (started.viaCart && result.stage !== 'comprado') {
      await this.goto(page, CART_URL)
      await pause(this.stepPauseMs)
      const cleared = await this.step(page, CART_CLEAR_EXPRESSION)
      const removed = amount(field(cleared, 'removed')) ?? 0
      return {
        ...result,
        message: `${result.message}${removed > 0 ? ' · se quitó del carrito' : ' · revisa el carrito: no se pudo quitar'}`
      }
    }
    return result
  }
}
