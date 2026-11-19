// Expressions evaluated in MercadoLibre's product and checkout pages. Each resolves to a JSON
// string describing what it saw or did, so the worker decides the next step from facts.
import type { OrderAddress } from './schedule-types'

/**
 * Reads the last amount of a text: MercadoLibre writes «$ 1.691 , 75 $ 913 , 12» (struck price,
 * then the one paid), with cents apart and «,» or «.» as thousands separator.
 */
export const MONEY_HELPER = `const money = (text) => {
    const all = [...(text || '').replace(/\\s/g, '').matchAll(/\\$([\\d.,]*\\d)/g)].map((m) => m[1]);
    if (all.length === 0) return null;
    const last = all[all.length - 1];
    const cents = /^(.*)[.,](\\d{2})$/.exec(last);
    return Number(cents ? cents[1].replace(/[.,]/g, '') + '.' + cents[2] : last.replace(/[.,]/g, ''));
  }`

const HELPERS = `
  const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && !el.disabled;
  const buttons = () => [...document.querySelectorAll('button, a[role=button], a.andes-button, input[type=submit]')].filter(visible);
  const byText = (re) => buttons().find((b) => re.test(norm(b.textContent || b.value)));
  ${MONEY_HELPER}
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

/**
 * Fills MercadoLibre's "Nuevo domicilio" form; it does not press «Guardar». The postal code fills
 * Estado, Municipio and Localidad by itself; Colonia is a list of that code's neighbourhoods.
 */
export function addressFormExpression(address: OrderAddress): string {
  return `(async () => {${HELPERS}
  const a = ${JSON.stringify(address)};
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const labelOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    const own = el.id && document.querySelector('label[for="' + el.id + '"]');
    return norm((by && document.getElementById(by)?.textContent) || (own && own.textContent) || el.getAttribute('aria-label') || '');
  };
  const input = (label) => [...document.querySelectorAll('input, textarea')].find((i) => i.type !== 'hidden' && labelOf(i).startsWith(norm(label)));
  const combo = (label) => [...document.querySelectorAll('[role=combobox]')].find((b) => b.tagName !== 'INPUT' && labelOf(b).startsWith(norm(label)));
  const type = async (label, value) => {
    const field = input(label);
    if (!field) throw new Error('No se encontró el campo «' + label + '»');
    field.focus(); setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
    field.blur(); await wait(500);
  };
  const choose = async (label, wanted) => {
    const box = combo(label);
    if (!box) throw new Error('No se encontró la lista «' + label + '»');
    if (norm(box.textContent) === norm(wanted)) return;
    box.click(); await wait(1200);
    const options = [...document.querySelectorAll('[role=option]')];
    const option = options.find((o) => norm(o.textContent) === norm(wanted)) || options.find((o) => norm(o.textContent).includes(norm(wanted)));
    if (!option) throw new Error('«' + wanted + '» no está entre las opciones de «' + label + '»');
    option.click(); await wait(800);
  };
  try {
    await type('Código Postal', a.postalCode); await wait(2500);
    await choose('Estado', a.state);
    await choose('Municipio', a.municipality);
    if (combo('Localidad') && norm(combo('Localidad').textContent).startsWith('selecciona')) await choose('Localidad', a.municipality);
    if (combo('Colonia')) await choose('Colonia', a.colonia); else await type('Colonia', a.colonia);
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
  const confirm = byText(/^(pagar y finalizar|confirmar compra|pagar|confirmar)$/);
  const totalLine = [...document.querySelectorAll('*')].reverse().find((el) => el.children.length < 4 && /^(total|pagas)\\b/.test(norm(el.textContent)) && /\\$/.test(el.textContent));
  const orderNumber = (text.match(/(?:compra|orden|pedido)[^0-9]{0,30}#?\\s?(\\d{8,})/) || [])[1] || null;
  // The innermost block that holds the "Medios de pago" heading and its radio buttons.
  const payment = [...document.querySelectorAll('section, div')]
    .filter((el) => /^medios de pago/.test(norm(el.textContent)) && el.querySelector('input[type=radio]'))
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
  const paymentChosen = !!(payment && payment.querySelector('input[type=radio]:checked'));
  let step = 'desconocido';
  if (/captcha|account-verification|login|security/.test(path)) step = 'verificacion';
  else if (/congrats|felicidades|ya tenemos tu compra|compra realizada/.test(path + ' ' + text)) step = 'comprado';
  else if (/\\/addresses\\/v3\\/map/.test(path)) step = 'mapa';
  else if (/\\/addresses\\/extra-info/.test(path)) step = 'detalles';
  else if (/addresses/.test(path)) step = 'domicilio';
  else if (confirm) step = 'resumen';
  else if (/elige como pagar|como quieres pagar/.test(text)) step = 'pago';
  else if (byText(/^continuar$/)) step = 'continuar';
  return { step, path, total: totalLine ? money(totalLine.textContent) : null, orderNumber, paymentChosen, text };
})())`

export const CONTINUE_EXPRESSION = `(async () => {${HELPERS}
  const next = byText(/^continuar$/);
  if (!next) return JSON.stringify({ ok: false });
  next.click();
  return JSON.stringify({ ok: true });
})()`

export const CONFIRM_EXPRESSION = `(async () => {${HELPERS}
  const confirm = byText(/^(pagar y finalizar|confirmar compra|pagar|confirmar)$/);
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

/** "Revisa la dirección": accepts the street and number it shows, then saves the address. */
export const MAP_CONFIRM_EXPRESSION = `(async () => {${HELPERS}
  const next = byText(/^continuar$/);
  if (next) { next.click(); await wait(1500); }
  const save = byText(/^guardar direccion$/);
  if (!save) return JSON.stringify({ ok: false, message: 'No se encontró «Guardar dirección»' });
  save.click();
  return JSON.stringify({ ok: true });
})()`

/** "Cuéntanos más sobre tu dirección" is optional. */
export const SKIP_DETAILS_EXPRESSION = `(async () => {${HELPERS}
  const skip = byText(/^omitir$/);
  if (!skip) return JSON.stringify({ ok: false, message: 'No se encontró «Omitir»' });
  skip.click();
  return JSON.stringify({ ok: true });
})()`

/** Removes every product of the cart; only used on a cart that was empty before the purchase. */
export const CART_CLEAR_EXPRESSION = `(async () => {${HELPERS}
  let removed = 0;
  for (let tries = 0; tries < 20; tries++) {
    const remove = [...document.querySelectorAll('button')].filter(visible).find((b) => norm(b.getAttribute('aria-label')) === 'eliminar producto');
    if (!remove) break;
    remove.click(); removed++; await wait(2500);
  }
  return JSON.stringify({ ok: true, removed });
})()`

/** The cart shows one tab at a time: «Mercado Libre» and «Full Súper» are checked one by one. */
export const CART_HUB_URLS = [CART_URL, `${CART_URL}?hub_selected=full_super`]

/**
 * The products the open cart tab lists, by title. The header's counter only counts the selected
 * ones, so the page is read instead.
 */
export const CART_ITEMS_EXPRESSION = `JSON.stringify((() => {${HELPERS}
  const removes = [...document.querySelectorAll('button')].filter(visible).filter((b) => norm(b.getAttribute('aria-label')) === 'eliminar producto');
  const titles = removes.map((b) => {
    let card = b;
    while (card.parentElement && !/\\$/.test(card.innerText || '')) card = card.parentElement;
    const link = card.querySelector('a[href*="MLM"], h2, h3, [class*=title]');
    return ((link && link.textContent) || card.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
  });
  return { titles };
})())`

export const ADDRESSES_URL =
  'https://www.mercadolibre.com.mx/addresses/v3/hub/actionable?app-id=MY_ML'

/**
 * Saved addresses of "Mi cuenta → Direcciones" that belong to `address`: same recipient, postal
 * code and phone. With `open`, opens the «Más acciones» menu of the first one.
 */
export function addressMatchesExpression(address: OrderAddress, open: boolean): string {
  return `(async () => {${HELPERS}
  const a = ${JSON.stringify({ recipient: address.recipient, postalCode: address.postalCode, phone: address.phone })};
  const digits = (t) => (t || '').replace(/\\D/g, '');
  const phone = digits(a.phone).slice(-8);
  const cards = [...document.querySelectorAll('button[aria-label^="Más acciones para"]')].filter(visible).map((menu) => {
    let card = menu;
    while (card.parentElement && !/codigo postal/.test(norm(card.innerText))) card = card.parentElement;
    return { menu, text: card.innerText || '' };
  }).filter((c) => norm(c.text).includes(norm(a.recipient)) && c.text.includes(a.postalCode) && digits(c.text).includes(phone));
  if (${open} && cards.length > 0) { cards[0].menu.click(); await wait(1200); }
  return JSON.stringify({ ok: ${open} ? cards.length > 0 : true, matches: cards.length });
})()`
}
