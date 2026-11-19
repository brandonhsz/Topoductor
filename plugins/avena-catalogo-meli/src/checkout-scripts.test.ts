import { assert, test } from 'orca/testing'
import { MONEY_HELPER } from './checkout-scripts'

// Runs the page helper exactly as the checkout pages do.
const money = new Function('text', `${MONEY_HELPER}; return money(text)`)

test('amounts read as MercadoLibre writes them: cents apart, struck price first', () => {
  const cases: [string, number | null][] = [
    ['Total $ 1.691 , 75 $ 913 , 12', 913.12],
    ['Total $ 282 , 78', 282.78],
    ['Pagas 1 mes de $ 913 , 12', 913.12],
    ['Total $ 259', 259],
    ['Total $ 1,592', 1592],
    ['Total $ 1,592 , 75', 1592.75],
    ['Total $ 12,345', 12345],
    ['Total', null]
  ]
  for (const [text, expected] of cases) {
    assert.equal(money(text), expected, text)
  }
})
