import { assert, test } from 'orca/testing'
import { CheckoutBrowser } from './checkout-browser'
import {
  addressFormExpression,
  BUY_NOW_EXPRESSION,
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
function fakeMeli(captchaReads: number) {
  const commands: string[][] = []
  let pathReads = 0
  const answers = new Map<string, unknown>([
    [quantityExpression(1), { ok: true }],
    [BUY_NOW_EXPRESSION, { ok: true }],
    [CHECKOUT_STATE_EXPRESSION, { step: 'domicilio' }],
    [addressFormExpression(ADDRESS), { ok: true }]
  ])
  const run: CliRunner = async (args) => {
    commands.push(args)
    if (args[0] === 'tab' && args[1] === 'list') {
      return { tabs: [{ browserPageId: 'p1', url: 'https://www.mercadolibre.com.mx/' }] }
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
    meli.commands.some((args) => args.join(' ') === 'tab switch --page p1 --focus'),
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
