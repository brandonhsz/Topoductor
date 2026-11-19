import { assert, test } from 'orca/testing'
import { CheckoutBrowser } from './checkout-browser'
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

test('a captcha on the product page stops as a verification, not as missing stock', async () => {
  const evaluated: string[] = []
  const run: CliRunner = async (args) => {
    if (args[0] === 'tab') {
      return { tabs: [{ browserPageId: 'p1', url: 'https://www.mercadolibre.com.mx/' }] }
    }
    if (args[0] !== 'eval') {
      return {}
    }
    const expression = args[4] ?? ''
    evaluated.push(expression)
    if (expression.includes('rl-card-featured')) {
      return { result: JSON.stringify({ url: 'https://articulo.mercadolibre.com.mx/MLM-1' }) }
    }
    return { result: JSON.stringify({ path: '/captcha/wall/logged' }) }
  }
  const result = await new CheckoutBrowser(new MeliBrowser(run)).checkout({
    referralUrl: 'https://meli.la/x',
    quantity: 1,
    address: ADDRESS,
    mode: 'prueba',
    maxTotal: 400
  })
  assert.equal(result.stage, 'verificacion')
  assert.match(result.message, /verificación/)
  assert.equal(evaluated.length, 2)
})
