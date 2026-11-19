import { assert, test } from 'orca/testing'
import { CheckoutBrowser, showsAddress } from './checkout-browser'
import {
  ADD_TO_CART_EXPRESSION,
  addressFormExpression,
  BUY_NOW_EXPRESSION,
  CART_CLEAR_EXPRESSION,
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
}

/** A tab that shows the captcha wall for the first `captchaReads` path reads, then the product. */
function fakeMeli({
  captchaReads = 0,
  actions = { buyNow: true, addToCart: false, cartCount: 0 },
  steps = FULL_CHECKOUT
}: Fake = {}) {
  const commands: string[][] = []
  let pathReads = 0
  let stateReads = 0
  const answers = new Map<string, unknown>([
    [quantityExpression(1), { ok: true }],
    [BUY_NOW_EXPRESSION, { ok: true }],
    [PRODUCT_ACTIONS_EXPRESSION, actions],
    [ADD_TO_CART_EXPRESSION, { ok: true }],
    [CART_CONTINUE_EXPRESSION, { ok: true }],
    [CART_CLEAR_EXPRESSION, { ok: true, removed: 1 }],
    [addressFormExpression(ADDRESS), { ok: true }],
    [SAVE_ADDRESS_EXPRESSION, { ok: true }],
    [MAP_CONFIRM_EXPRESSION, { ok: true }],
    [SKIP_DETAILS_EXPRESSION, { ok: true }],
    [CONFIRM_EXPRESSION, { ok: true }]
  ])
  const run: CliRunner = async (args) => {
    commands.push(args)
    if (args[0] === 'tab' && args[1] === 'list') {
      return {
        tabs: [{ browserPageId: 'p1', url: 'https://www.mercadolibre.com.mx/', worktreeId: 'w1' }]
      }
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
    return { result: JSON.stringify(answers.get(expression) ?? { ok: false }) }
  }
  const ran = (expression: string) =>
    commands.some((args) => args[0] === 'eval' && args[4] === expression)
  return { run, commands, ran }
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

test('a cart-only product stops when the account cart already holds other products', async () => {
  const meli = fakeMeli({ actions: { buyNow: false, addToCart: true, cartCount: 10 } })
  const result = await buy(meli).checkout({ ...REQUEST, mode: 'real' })
  assert.equal(result.stage, 'carrito')
  assert.match(result.message, /10 productos/)
  assert.equal(meli.ran(ADD_TO_CART_EXPRESSION), false)
  assert.equal(meli.ran(CART_CLEAR_EXPRESSION), false)
})

test('test mode buys a cart-only product through the cart and empties it afterwards', async () => {
  const meli = fakeMeli({ actions: { buyNow: false, addToCart: true, cartCount: 0 } })
  const result = await buy(meli).checkout(REQUEST)
  assert.equal(meli.ran(ADD_TO_CART_EXPRESSION), true)
  assert.equal(meli.ran(CART_CONTINUE_EXPRESSION), true)
  assert.equal(result.stage, 'resumen')
  assert.equal(result.testPassed, true)
  assert.equal(meli.commands.filter((args) => args[0] === 'goto' && args[4] === CART_URL).length, 2)
  assert.equal(meli.ran(CART_CLEAR_EXPRESSION), true)
  assert.match(result.message, /se quitó del carrito/)
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
