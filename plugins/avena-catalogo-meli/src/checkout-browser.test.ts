import { assert, test } from 'orca/testing'
import { CheckoutBrowser, showsAddress } from './checkout-browser'
import {
  ADD_TO_CART_EXPRESSION,
  addressFormExpression,
  BUY_NOW_EXPRESSION,
  ADDRESSES_URL,
  addressMatchesExpression,
  CART_CLEAR_EXPRESSION,
  CART_HUB_URLS,
  CART_ITEMS_EXPRESSION,
  CART_CONTINUE_EXPRESSION,
  CART_URL,
  CHECKOUT_STATE_EXPRESSION,
  CONFIRM_EXPRESSION,
  MAP_CONFIRM_EXPRESSION,
  PAGE_PATH_EXPRESSION,
  PRODUCT_ACTIONS_EXPRESSION,
  quantityExpression,
  SAVE_ADDRESS_EXPRESSION,
  SKIP_DETAILS_EXPRESSION
} from './checkout-scripts'
import { MeliBrowser, type CliRunner } from './meli-browser'

const ADDRESS = {
  recipient: 'Prueba',
  phone: '3312345678',
  street: 'Avenida Patria',
  number: '1200',
  interior: null,
  colonia: 'Jardines Universidad',
  postalCode: '45110',
  municipality: 'Zapopan',
  state: 'Jalisco',
  references: null
}

const REQUEST = {
  referralUrl: 'https://meli.la/x',
  quantity: 1,
  address: ADDRESS,
  mode: 'prueba' as const,
  maxTotal: 400
}

const REVIEW = {
  step: 'resumen',
  total: 259,
  paymentChosen: false,
  text: 'now foods picolinato forma de entrega avenida patria 1200 cambiar direccion medios de pago total $ 259'
}

/** The checkout pages in the order MercadoLibre shows them to an account without addresses. */
const FULL_CHECKOUT = [{ step: 'domicilio' }, { step: 'mapa' }, { step: 'detalles' }, REVIEW]

type Fake = {
  captchaReads?: number
  actions?: unknown
  steps?: unknown[]
  /** What each cart tab holds when the purchase starts. */
  cart?: { marketplace?: string[]; fullSuper?: string[] }
  /** The cart keeps its products whatever is clicked. */
  stuckCart?: boolean
  /** «Eliminar» on an address does nothing. */
  stuckAddress?: boolean
}

/**
 * A MercadoLibre tab: a captcha for the first `captchaReads` path reads, then the product; a cart
 * with two tabs, and the account's saved addresses with their «Más acciones» menu.
 */
function fakeMeli({
  captchaReads = 0,
  actions = { buyNow: true, addToCart: false, price: 160 },
  steps = FULL_CHECKOUT,
  cart = {},
  stuckCart = false,
  stuckAddress = false
}: Fake = {}) {
  const commands: string[][] = []
  let pathReads = 0
  let stateReads = 0
  let url = ''
  let dialog: 'none' | 'menu' | 'confirm' = 'none'
  const hubs = {
    marketplace: [...(cart.marketplace ?? [])],
    fullSuper: [...(cart.fullSuper ?? [])]
  }
  const addresses: string[] = []
  const hub = () => (url.includes('full_super') ? hubs.fullSuper : hubs.marketplace)
  const answers = new Map<string, () => unknown>([
    [quantityExpression(1), () => ({ ok: true })],
    [BUY_NOW_EXPRESSION, () => ({ ok: true })],
    [PRODUCT_ACTIONS_EXPRESSION, () => actions],
    [ADD_TO_CART_EXPRESSION, () => (hubs.fullSuper.push('Proteína Gold Standard'), { ok: true })],
    [CART_CONTINUE_EXPRESSION, () => ({ ok: true })],
    [CART_ITEMS_EXPRESSION, () => ({ titles: url.startsWith(CART_URL) ? [...hub()] : [] })],
    [
      CART_CLEAR_EXPRESSION,
      () => {
        const removed = stuckCart ? 0 : hub().splice(0).length
        return { ok: true, removed }
      }
    ],
    [addressFormExpression(ADDRESS), () => ({ ok: true })],
    [SAVE_ADDRESS_EXPRESSION, () => (addresses.push('Prueba'), { ok: true })],
    [MAP_CONFIRM_EXPRESSION, () => ({ ok: true })],
    [SKIP_DETAILS_EXPRESSION, () => ({ ok: true })],
    [CONFIRM_EXPRESSION, () => ({ ok: true })],
    [
      addressMatchesExpression(ADDRESS, true),
      () => {
        if (addresses.length === 0 || url !== ADDRESSES_URL) {
          return { ok: false, matches: 0 }
        }
        dialog = 'menu'
        return { ok: true, matches: addresses.length }
      }
    ],
    [
      addressMatchesExpression(ADDRESS, false),
      () => ({ ok: true, matches: url === ADDRESSES_URL ? addresses.length : -1 })
    ]
  ])
  const snapshots = {
    none: '- main',
    menu: '- dialog "Más acciones para Avenida Patria 1200"\n  - button "Editar" [ref=e1]\n  - button "Eliminar" [ref=e2]',
    confirm:
      '- dialog "¿Quieres eliminar esta dirección?"\n  - button "Eliminar" [ref=e3]\n  - button "Cancelar" [ref=e4]'
  }
  const run: CliRunner = async (args) => {
    commands.push(args)
    if (args[0] === 'tab' && args[1] === 'list') {
      return {
        tabs: [{ browserPageId: 'p1', url: 'https://www.mercadolibre.com.mx/', worktreeId: 'w1' }]
      }
    }
    if (args[0] === 'goto') {
      url = args[4] ?? ''
      dialog = 'none'
      return {}
    }
    if (args[0] === 'snapshot') {
      return { snapshot: snapshots[dialog] }
    }
    if (args[0] === 'click') {
      if (args[2] === 'e2' && dialog === 'menu') {
        dialog = 'confirm'
      } else if (args[2] === 'e3' && dialog === 'confirm') {
        dialog = 'none'
        if (!stuckAddress) {
          addresses.shift()
        }
      }
      return { clicked: args[2] }
    }
    if (args[0] !== 'eval') {
      return {}
    }
    const expression = args[4] ?? ''
    if (expression === PAGE_PATH_EXPRESSION) {
      pathReads++
      const path = pathReads <= captchaReads ? '/captcha/wall/logged' : '/MLM-1'
      return { result: JSON.stringify({ path }) }
    }
    if (expression === CHECKOUT_STATE_EXPRESSION) {
      const state = steps[Math.min(stateReads, steps.length - 1)]
      stateReads++
      return { result: JSON.stringify(state) }
    }
    if (expression.includes('rl-card-featured')) {
      return { result: JSON.stringify({ url: 'https://articulo.mercadolibre.com.mx/MLM-1' }) }
    }
    return { result: JSON.stringify(answers.get(expression)?.() ?? { ok: false }) }
  }
  const ran = (expression: string) =>
    commands.some((args) => args[0] === 'eval' && args[4] === expression)
  const visited = (target: string) =>
    commands.some((args) => args[0] === 'goto' && args[4] === target)
  return { run, commands, ran, visited, hubs, addresses }
}

const options = (notes: string[], waitMs = 10) => ({
  waitMs,
  pollMs: 1,
  stepPauseMs: 0,
  onVerification: (message: string) => notes.push(message)
})

const buy = (meli: ReturnType<typeof fakeMeli>, notes: string[] = [], waitMs = 10) =>
  new CheckoutBrowser(new MeliBrowser(meli.run), options(notes, waitMs))

test('test mode walks address, map and details to the payment screen and stops there', async () => {
  const meli = fakeMeli()
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(result.stage, 'resumen')
  assert.equal(result.testPassed, true)
  assert.equal(result.total, 259)
  assert.match(result.message, /pantalla de pago/)
  for (const expression of [
    SAVE_ADDRESS_EXPRESSION,
    MAP_CONFIRM_EXPRESSION,
    SKIP_DETAILS_EXPRESSION
  ]) {
    assert.ok(meli.ran(expression))
  }
  assert.equal(meli.ran(CONFIRM_EXPRESSION), false)
})

test('a captcha brings the tab to the front, waits for a person and then carries on', async () => {
  const meli = fakeMeli({ captchaReads: 3 })
  const notes: string[] = []
  const result = await buy(meli, notes, 1000).checkout(REQUEST)
  assert.equal(result.stage, 'resumen')
  assert.ok(
    meli.commands.some((args) => args.join(' ') === 'worktree activate --worktree id:w1'),
    'opens the workspace that holds the tab'
  )
  assert.ok(
    meli.commands.some(
      (args) => args.join(' ') === 'tab switch --page p1 --worktree id:w1 --focus'
    ),
    'reveals the tab'
  )
  assert.equal(notes.length, 1)
})

test('a captcha nobody solves in time stops as a verification', async () => {
  const meli = fakeMeli({ captchaReads: Number.POSITIVE_INFINITY })
  const result = await buy(meli, [], 20).checkout(REQUEST)
  assert.equal(result.stage, 'verificacion')
  assert.match(result.message, /nadie/)
})

test('a cart-only product stops when the cart holds other products, which the close removes', async () => {
  const meli = fakeMeli({
    actions: { buyNow: false, addToCart: true },
    cart: { fullSuper: ['Omega 3 Salmón B Life'] }
  })
  const result = await buy(meli).checkout({ ...REQUEST, mode: 'real' })
  assert.equal(result.stage, 'carrito')
  assert.match(result.message, /1 producto/)
  assert.equal(meli.ran(ADD_TO_CART_EXPRESSION), false)
  assert.match(result.message, /Omega 3 Salmón B Life/)
  assert.deepEqual(meli.hubs.fullSuper, [])
  assert.equal(result.cleanupFailed, undefined)
})

test('test mode buys a cart-only product through the cart and empties it afterwards', async () => {
  const meli = fakeMeli({ actions: { buyNow: false, addToCart: true } })
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(meli.ran(ADD_TO_CART_EXPRESSION), true)
  assert.equal(meli.ran(CART_CONTINUE_EXPRESSION), true)
  assert.equal(result.stage, 'resumen')
  assert.equal(result.testPassed, true)
  assert.match(result.message, /se quitó del carrito: Proteína Gold Standard/)
  assert.deepEqual(meli.hubs.fullSuper, [])
})

test('every purchase ends deleting the order address and checking both cart tabs', async () => {
  const meli = fakeMeli()
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(result.stage, 'resumen')
  assert.deepEqual(meli.addresses, [])
  assert.match(result.message, /domicilio del pedido eliminado/)
  assert.match(result.message, /carrito vacío/)
  for (const cartUrl of CART_HUB_URLS) {
    assert.ok(meli.visited(cartUrl), cartUrl)
  }
  assert.ok(
    meli.commands.some((args) => args.join(' ') === 'click --element e3 --worktree id:w1'),
    'confirms the deletion in its dialog'
  )
  assert.equal(result.cleanupFailed, undefined)
})

test('a cart that cannot be emptied is flagged', async () => {
  const meli = fakeMeli({ cart: { marketplace: ['Birdman Creatina'] }, stuckCart: true })
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(result.cleanupFailed, true)
  assert.match(result.message, /⚠ el carrito no quedó vacío: Birdman Creatina/)
})

test('an address that cannot be deleted is flagged', async () => {
  const meli = fakeMeli({ stuckAddress: true })
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(result.cleanupFailed, true)
  assert.match(result.message, /⚠ no se pudo eliminar el domicilio/)
})

test('a real purchase never confirms without a payment method chosen', async () => {
  const meli = fakeMeli({ actions: { buyNow: false, addToCart: true, cartCount: 0 } })
  const result = await buy(meli).checkout({ ...REQUEST, mode: 'real' })
  assert.equal(result.stage, 'pago')
  assert.equal(meli.ran(CONFIRM_EXPRESSION), false)
  assert.equal(meli.ran(CART_CLEAR_EXPRESSION), true)
})

test('a real purchase confirms within the cap once a payment method is chosen', async () => {
  const meli = fakeMeli({
    steps: [
      { ...REVIEW, paymentChosen: true },
      { step: 'comprado', total: 259, orderNumber: '2000001' }
    ]
  })
  const result = await buy(meli).checkout({ ...REQUEST, mode: 'real' })
  assert.equal(meli.ran(CONFIRM_EXPRESSION), true)
  assert.equal(result.stage, 'comprado')
  assert.equal(result.orderNumber, '2000001')
})

test('a listing with neither button says so', async () => {
  const meli = fakeMeli({ actions: { buyNow: false, addToCart: false, cartCount: 0 } })
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(result.stage, 'producto')
  assert.match(result.message, /ni «Agregar al carrito»/)
})

test('the review must name the order street and number', () => {
  assert.equal(showsAddress('Avenida Patria 1200 Cambiar dirección', ADDRESS), true)
  assert.equal(showsAddress('Calle Falsa 123 Cambiar dirección', ADDRESS), false)
  assert.equal(showsAddress('Avenida Patria 980', ADDRESS), false)
})

test('without a fixed cap, the cap is the price on the product page plus shipping', async () => {
  const meli = fakeMeli()
  const result = await buy(meli).checkout({ ...REQUEST, maxTotal: null })
  assert.equal(result.stage, 'resumen')
  assert.equal(result.testPassed, true)
})

test('an unexpected charge over the product page price is never paid', async () => {
  const meli = fakeMeli({ steps: [{ ...REVIEW, total: 420, text: REVIEW.text }] })
  const result = await buy(meli).checkout({ ...REQUEST, mode: 'real', maxTotal: null })
  assert.equal(result.stage, 'resumen')
  assert.match(result.message, /supera el tope/)
  assert.equal(meli.ran(CONFIRM_EXPRESSION), false)
})

test('a product page without a readable price stops when there is no fixed cap', async () => {
  const meli = fakeMeli({ actions: { buyNow: true, addToCart: false, price: null } })
  const result = await buy(meli).checkout({ ...REQUEST, maxTotal: null })
  assert.equal(result.stage, 'producto')
  assert.match(result.message, /precio/)
})
