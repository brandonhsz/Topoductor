// Closing a purchase session, whatever happened in it: the order's address is deleted from the
// account and the cart must end empty, so the next purchase never inherits either.
import {
  ADDRESSES_URL,
  addressMatchesExpression,
  CART_CLEAR_EXPRESSION,
  CART_HUB_URLS,
  CART_ITEMS_EXPRESSION
} from './checkout-scripts'
import { amount, field, text } from './json-fields'
import type { MeliBrowser, Tab } from './meli-browser'
import type { OrderAddress } from './schedule-types'

export type SessionPage = {
  browser: MeliBrowser
  tab: Tab
  goto(url: string): Promise<void>
  step(expression: string): Promise<unknown>
  pause(): Promise<void>
}

export type CloseReport = { ok: boolean; note: string }

const MAX_ROUNDS = 5

function titles(answer: unknown): string[] {
  const listed = field(answer, 'titles')
  // In the narrow cart each product has two «Eliminar producto» buttons: one title per product.
  return Array.isArray(listed) ? [...new Set(listed.flatMap((title) => text(title) ?? []))] : []
}

/** Every product in the cart, both tabs, read from the pages. */
export async function cartContents(page: SessionPage): Promise<string[]> {
  const found: string[] = []
  for (const url of CART_HUB_URLS) {
    await page.goto(url)
    await page.pause()
    found.push(...titles(await page.step(CART_ITEMS_EXPRESSION)))
  }
  return found
}

async function emptyCart(page: SessionPage): Promise<{ removed: string[]; left: string[] }> {
  const removed: string[] = []
  for (const url of CART_HUB_URLS) {
    await page.goto(url)
    await page.pause()
    const listed = titles(await page.step(CART_ITEMS_EXPRESSION))
    if (listed.length > 0) {
      const cleared = await page.step(CART_CLEAR_EXPRESSION)
      if ((amount(field(cleared, 'removed')) ?? 0) > 0) {
        removed.push(...listed)
      }
    }
  }
  return { removed, left: await cartContents(page) }
}

async function deleteAddresses(page: SessionPage, address: OrderAddress): Promise<number> {
  await page.goto(ADDRESSES_URL)
  await page.pause()
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const opened = await page.step(addressMatchesExpression(address, true))
    if (field(opened, 'ok') !== true) {
      break
    }
    const chosen = await page.browser.clickInDialog(page.tab, /Más acciones para/, 'Eliminar')
    const confirmed =
      chosen && (await page.browser.clickInDialog(page.tab, /eliminar esta direcci/i, 'Eliminar'))
    if (!confirmed) {
      break
    }
    await page.pause()
    await page.goto(ADDRESSES_URL)
    await page.pause()
  }
  const left = await page.step(addressMatchesExpression(address, false))
  return amount(field(left, 'matches')) ?? -1
}

export async function closeSession(page: SessionPage, address: OrderAddress): Promise<CloseReport> {
  const notes: string[] = []
  let ok = true
  const addressesLeft = await deleteAddresses(page, address).catch(() => -1)
  if (addressesLeft === 0) {
    notes.push('domicilio del pedido eliminado')
  } else {
    ok = false
    notes.push('⚠ no se pudo eliminar el domicilio del pedido de la cuenta')
  }
  const cart = await emptyCart(page).catch(() => ({ removed: [], left: ['(no se pudo leer)'] }))
  if (cart.removed.length > 0) {
    notes.push(`se quitó del carrito: ${cart.removed.join(', ')}`)
  }
  if (cart.left.length === 0) {
    notes.push('carrito vacío')
  } else {
    ok = false
    notes.push(`⚠ el carrito no quedó vacío: ${cart.left.join(', ')}`)
  }
  return { ok, note: notes.join(' · ') }
}
