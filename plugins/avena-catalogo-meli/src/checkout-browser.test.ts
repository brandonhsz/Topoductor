import { assert, test } from 'orca/testing'
import { CheckoutBrowser } from './checkout-browser'
import {
  ADD_TO_CART_EXPRESSION,
  addressFormExpression,
  BUY_NOW_EXPRESSION,
  CART_CONTINUE_EXPRESSION,
  CART_URL,
  PRODUCT_ACTIONS_EXPRESSION,
  CHECKOUT_STATE_EXPRESSION,
  PAGE_PATH_EXPRESSION,
  quantityExpression
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

/** A tab that shows the captcha wall for the first `captchaReads` path reads, then the product. */
function fakeMeli(
  captchaReads: number,
  actions: unknown = { buyNow: true, addToCart: false, cartCount: 0 },
  checkoutStep = 'domicilio'
) {
  const commands: string[][] = []
  let pathReads = 0
  const answers = new Map<string, unknown>([
    [quantityExpression(1), { ok: true }],
    [BUY_NOW_EXPRESSION, { ok: true }],
    [CHECKOUT_STATE_EXPRESSION, { step: checkoutStep }],
    [PRODUCT_ACTIONS_EXPRESSION, actions],
    [ADD_TO_CART_EXPRESSION, { ok: true }],
    [CART_CONTINUE_EXPRESSION, { ok: true }],
    [addressFormExpression(ADDRESS), { ok: true }]
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
    if (expression.includes('rl-card-featured')) {
      return { result: JSON.stringify({ url: 'https://articulo.mercadolibre.com.mx/MLM-1' }) }
    }
    return { result: JSON.stringify(answers.get(expression) ?? { ok: false }) }
  }
  return { run, commands }
}

const options = (notes: string[], waitMs: number) => ({
  waitMs,
  pollMs: 1,
  stepPauseMs: 0,
  onVerification: (message: string) => notes.push(message)
})

test('a captcha brings the tab to the front, waits for a person and then carries on', async () => {
  const meli = fakeMeli(3)
  const notes: string[] = []
  const result = await new CheckoutBrowser(
    new MeliBrowser(meli.run),
    options(notes, 1000)
  ).checkout(REQUEST)
  assert.equal(result.stage, 'domicilio')
  assert.match(result.message, /Domicilio llenado/)
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
  const meli = fakeMeli(Number.POSITIVE_INFINITY)
  const notes: string[] = []
  const result = await new CheckoutBrowser(new MeliBrowser(meli.run), options(notes, 20)).checkout(
    REQUEST
  )
  assert.equal(result.stage, 'verificacion')
  assert.match(result.message, /nadie/)
})

const ran = (commands: string[][], expression: string) =>
  commands.some((args) => args[0] === 'eval' && args[4] === expression)

test('a cart-only product stops when the account cart already holds other products', async () => {
  const meli = fakeMeli(0, { buyNow: false, addToCart: true, cartCount: 10 })
  const result = await new CheckoutBrowser(new MeliBrowser(meli.run), options([], 10)).checkout({
    ...REQUEST,
    mode: 'real'
  })
  assert.equal(result.stage, 'carrito')
  assert.match(result.message, /10 productos/)
  assert.equal(ran(meli.commands, ADD_TO_CART_EXPRESSION), false)
})

test('in test mode a cart-only product with an empty cart is ready, and nothing is added', async () => {
  const meli = fakeMeli(0, { buyNow: false, addToCart: true, cartCount: 0 })
  const result = await new CheckoutBrowser(new MeliBrowser(meli.run), options([], 10)).checkout(
    REQUEST
  )
  assert.equal(result.stage, 'carrito')
  assert.equal(result.testPassed, true)
  assert.equal(ran(meli.commands, ADD_TO_CART_EXPRESSION), false)
})

test('a real purchase of a cart-only product adds it and continues from the cart', async () => {
  const meli = fakeMeli(0, { buyNow: false, addToCart: true, cartCount: 0 }, 'pago')
  const result = await new CheckoutBrowser(new MeliBrowser(meli.run), options([], 10)).checkout({
    ...REQUEST,
    mode: 'real'
  })
  assert.equal(ran(meli.commands, ADD_TO_CART_EXPRESSION), true)
  assert.ok(meli.commands.some((args) => args[0] === 'goto' && args[4] === CART_URL))
  assert.equal(ran(meli.commands, CART_CONTINUE_EXPRESSION), true)
  assert.equal(result.stage, 'pago')
})

test('a listing with neither button says so', async () => {
  const meli = fakeMeli(0, { buyNow: false, addToCart: false, cartCount: 0 })
  const result = await new CheckoutBrowser(new MeliBrowser(meli.run), options([], 10)).checkout(
    REQUEST
  )
  assert.equal(result.stage, 'producto')
  assert.match(result.message, /ni «Agregar al carrito»/)
})
