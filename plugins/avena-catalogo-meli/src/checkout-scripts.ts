// Expressions evaluated in MercadoLibre's product and checkout pages. Each resolves to a JSON
// string describing what it saw or did, so the worker decides the next step from facts.
import type { OrderAddress } from './schedule-types'

const HELPERS = `
  const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && !el.disabled;
  const buttons = () => [...document.querySelectorAll('button, a[role=button], input[type=submit]')].filter(visible);
  const byText = (re) => buttons().find((b) => re.test(norm(b.textContent || b.value)));
  const money = (text) => { const m = (text || '').replace(/\\s/g, '').match(/\\$([\\d.,]+)/); return m ? Number(m[1].replace(/,/g, '')) : null };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`

/** The product link of the referral's featured card, with its affiliate parameters. */
export const FEATURED_PRODUCT_EXPRESSION = `JSON.stringify((() => {
  const a = document.querySelector('.rl-card-featured a[href*="MLM"]');
  return { url: a ? a.href : null };
})())`

/** Picks the quantity on a product page; "1" needs nothing. */
export function quantityExpression(quantity: number): string {
  return `(async () => {${HELPERS}
  if (${quantity} <= 1) return JSON.stringify({ ok: true });
  const trigger = [...document.querySelectorAll('button, [role=combobox]')].find((b) => /^cantidad/.test(norm(b.getAttribute('aria-label') || b.textContent)));
  if (!trigger) return JSON.stringify({ ok: false, message: 'No se encontró el selector de cantidad' });
  trigger.click();
  await wait(700);
  const option = [...document.querySelectorAll('[role=option], li')].find((o) => new RegExp('^${quantity} unidad').test(norm(o.textContent)));
  if (!option) return JSON.stringify({ ok: false, message: 'La publicación no ofrece ${quantity} unidades' });
  option.click();
  await wait(700);
  return JSON.stringify({ ok: true });
})()`
}

export const BUY_NOW_EXPRESSION = `(async () => {${HELPERS}
  const buy = byText(/^comprar ahora$/);
  if (!buy) return JSON.stringify({ ok: false, message: 'La publicación no tiene «Comprar ahora» (sin stock o pausada)' });
  buy.click();
  return JSON.stringify({ ok: true });
})()`

/** Fills MercadoLibre's "Nuevo domicilio" form; it does not press «Guardar». */
export function addressFormExpression(address: OrderAddress): string {
  return `(async () => {${HELPERS}
  const a = ${JSON.stringify(address)};
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const field = (label) => {
    const l = [...document.querySelectorAll('label')].find((x) => norm(x.textContent).startsWith(norm(label)));
    const id = l && l.getAttribute('for');
    return (id && document.getElementById(id)) || [...document.querySelectorAll('input')].find((i) => norm(i.getAttribute('aria-label')).startsWith(norm(label)));
  };
  const type = async (label, value) => {
    const input = field(label);
    if (!input) throw new Error('No se encontró el campo «' + label + '»');
    input.focus(); setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur(); await wait(500);
  };
  const choose = async (label, wanted) => {
    const box = [...document.querySelectorAll('[role=combobox]')].find((b) => norm(b.getAttribute('aria-label') || '').startsWith(norm(label)) || norm(b.closest('div')?.textContent || '').startsWith(norm(label)));
    if (!box) throw new Error('No se encontró la lista «' + label + '»');
    box.click(); await wait(800);
    const options = [...document.querySelectorAll('[role=option]')];
    const option = options.find((o) => norm(o.textContent) === norm(wanted)) || options.find((o) => norm(o.textContent).includes(norm(wanted))) || (options.length === 1 ? options[0] : null);
    if (!option) throw new Error('«' + wanted + '» no está entre las opciones de «' + label + '»');
    option.click(); await wait(800);
  };
  try {
    await type('Código Postal', a.postalCode); await wait(1500);
    await choose('Estado', a.state);
    await choose('Municipio', a.municipality);
    const locality = [...document.querySelectorAll('[role=combobox]')].find((b) => /localidad/.test(norm(b.getAttribute('aria-label') || b.closest('div')?.textContent)));
    if (locality) await choose('Localidad', a.municipality);
    await type('Colonia', a.colonia);
    await type('Dirección', a.street + ' ' + a.number);
    if (a.interior) await type('Número interior', a.interior);
    await type('Nombre y apellido', a.recipient);
    await type('Teléfono', a.phone);
    return JSON.stringify({ ok: true });
  } catch (error) {
    return JSON.stringify({ ok: false, message: String(error && error.message || error) });
  }
})()`
}

export const SAVE_ADDRESS_EXPRESSION = `(async () => {${HELPERS}
  const save = byText(/^guardar$/);
  if (!save) return JSON.stringify({ ok: false, message: 'No se encontró «Guardar» en el domicilio' });
  save.click();
  return JSON.stringify({ ok: true });
})()`

/** What checkout step the page is on, with the total when the review shows it. */
export const CHECKOUT_STATE_EXPRESSION = `JSON.stringify((() => {${HELPERS}
  const text = norm(document.body.innerText).slice(0, 6000);
  const path = location.pathname;
  const confirm = byText(/^(confirmar compra|pagar|confirmar)$/);
  const totalLine = [...document.querySelectorAll('*')].reverse().find((el) => el.children.length < 4 && /^(total|pagas)\\b/.test(norm(el.textContent)) && /\\$/.test(el.textContent));
  const orderNumber = (text.match(/(?:compra|orden|pedido)[^0-9]{0,30}#?\\s?(\\d{8,})/) || [])[1] || null;
  let step = 'desconocido';
  if (/captcha|account-verification|login|security/.test(path)) step = 'verificacion';
  else if (/congrats|felicidades|ya tenemos tu compra|compra realizada/.test(path + ' ' + text)) step = 'comprado';
  else if (/addresses/.test(path)) step = 'domicilio';
  else if (confirm) step = 'resumen';
  else if (/elige como pagar|medio de pago|como quieres pagar/.test(text)) step = 'pago';
  else if (byText(/^continuar$/)) step = 'continuar';
  return { step, path, total: totalLine ? money(totalLine.textContent) : null, orderNumber, text };
})())`

export const CONTINUE_EXPRESSION = `(async () => {${HELPERS}
  const next = byText(/^continuar$/);
  if (!next) return JSON.stringify({ ok: false });
  next.click();
  return JSON.stringify({ ok: true });
})()`

export const CONFIRM_EXPRESSION = `(async () => {${HELPERS}
  const confirm = byText(/^(confirmar compra|pagar|confirmar)$/);
  if (!confirm) return JSON.stringify({ ok: false, message: 'Ya no está el botón de confirmar' });
  confirm.click();
  return JSON.stringify({ ok: true });
})()`

/** Where the tab is: MercadoLibre answers a suspicious visit with a captcha wall. */
export const PAGE_PATH_EXPRESSION = 'JSON.stringify({ path: location.pathname })'

export const isVerificationPath = (path: string): boolean =>
  /captcha|account-verification|\/login|\/security/.test(path)

/** Which way to buy a listing offers, and how many products the account cart already holds. */
export const PRODUCT_ACTIONS_EXPRESSION = `JSON.stringify((() => {${HELPERS}
  const cart = document.querySelector('a.nav-cart');
  const count = Number(((cart && cart.getAttribute('aria-label')) || '').match(/\\d+/)?.[0] || 0);
  return {
    buyNow: !!byText(/^comprar ahora$/),
    addToCart: !!byText(/^agregar al carrito$/),
    cartCount: count
  };
})())`

export const ADD_TO_CART_EXPRESSION = `(async () => {${HELPERS}
  const add = byText(/^agregar al carrito$/);
  if (!add) return JSON.stringify({ ok: false, message: 'Ya no está «Agregar al carrito»' });
  add.click();
  return JSON.stringify({ ok: true });
})()`

export const CART_URL = 'https://www.mercadolibre.com.mx/gz/cart/v2'

export const CART_CONTINUE_EXPRESSION = `(async () => {${HELPERS}
  // The cart labels it «Continuar compra» or «Continuar (N)», N being the products selected.
  const next = byText(/^continuar( compra)?( \\(\\d+\\))?$/);
  if (!next) return JSON.stringify({ ok: false, message: 'El carrito no muestra «Continuar»' });
  next.click();
  return JSON.stringify({ ok: true });
})()`
