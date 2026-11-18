// Expressions evaluated inside a mercadolibre.com.mx tab of Topo's browser. They run in the
// page, so they are plain JavaScript strings and resolve to a JSON string.

export const LINKBUILDER_URL = 'https://www.mercadolibre.com.mx/afiliados/linkbuilder'
export const LINKBUILDER_BATCH = 11

/** The affiliate tag shown on the link builder, or the page path when the session is gone. */
export const SESSION_EXPRESSION = `JSON.stringify({
  path: location.pathname,
  tag: ([...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /^al\\d+$/i.test(t)) || null)
})`

/**
 * Opens each meli.la in a hidden iframe: it redirects to the affiliate's social profile on this
 * origin, whose featured card is the product. Landing on /lists means the link is broken.
 */
export function readCardsExpression(urls: readonly string[], concurrency = 10): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)};
  const money = (el) => {
    if (!el) return null;
    const fraction = el.querySelector('.andes-money-amount__fraction');
    if (!fraction) return null;
    const cents = el.querySelector('.andes-money-amount__cents');
    return Number(fraction.textContent.replace(/[.,]/g, '') + (cents ? '.' + cents.textContent.trim() : ''));
  };
  const imageOf = (card) => {
    const img = card.querySelector('img');
    return img ? (img.getAttribute('data-src') || img.currentSrc || img.src || null) : null;
  };
  const extract = (doc, url) => {
    const card = doc && doc.querySelector && doc.querySelector('.rl-card-featured');
    const path = doc && doc.location ? doc.location.pathname : null;
    if (!card) {
      return { url, ok: false, path, blocked: !!path && /account-verification|login/.test(path) };
    }
    const q = (s) => card.querySelector(s);
    const discountText = (q('.andes-money-amount__discount') || {}).textContent || '';
    const discount = discountText.match(/(\\d+)\\s*%/);
    const price = money(q('.poly-price__current .andes-money-amount'));
    const listPrice = money(q('.andes-money-amount--previous'));
    const link = q('a[href*="MLM"]');
    return {
      url, ok: true, path, price, listPrice,
      discountPercentage: discount ? Number(discount[1]) : (listPrice && price ? Math.round(100 * (listPrice - price) / listPrice) : null),
      title: ((q('.poly-component__title') || {}).textContent || '').trim() || null,
      seller: ((q('.poly-component__seller') || {}).textContent || '').trim().replace(/^Por /, '') || null,
      mlItemId: link ? ((link.href.match(/MLM-?\\w*\\d+/) || [null])[0]) : null,
      imageUrl: imageOf(card)
    };
  };
  const open = (url) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:1200px;height:900px;position:fixed;left:-9999px';
    const started = Date.now();
    const poll = setInterval(() => {
      let doc = null;
      try { doc = frame.contentDocument } catch (e) {}
      const path = doc && doc.location ? doc.location.pathname : '';
      const done = (doc && doc.querySelector && doc.querySelector('.rl-card-featured')) || path.endsWith('/lists') || /account-verification|login/.test(path);
      if (done || Date.now() - started > 25000) {
        clearInterval(poll);
        resolve(extract(doc, url));
        frame.remove();
      }
    }, 300);
    frame.src = url;
    document.body.appendChild(frame);
  });
  const results = [];
  let next = 0;
  const worker = async () => { while (next < urls.length) { const url = urls[next++]; results.push(await open(url)); } };
  await Promise.all(Array.from({ length: ${concurrency} }, worker));
  return JSON.stringify(results);
})()`
}

/** Fills the link builder (React-controlled textarea) and reads one output line per input URL. */
export function generateLinksExpression(urls: readonly string[]): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)};
  const input = document.getElementById('url-0');
  if (!input) return JSON.stringify({ error: 'No se encontró el generador de links' });
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  const output = () => (document.getElementById('textfield-copyLink-1') || {}).value || '';
  input.focus();
  setValue.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  setValue.call(input, urls.join('\\n'));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  const before = output();
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Generar');
  if (!button) return JSON.stringify({ error: 'No se encontró el botón Generar' });
  button.click();
  const started = Date.now();
  let value = '';
  while (Date.now() - started < 30000) {
    await new Promise((r) => setTimeout(r, 700));
    value = output();
    if (value && value !== before && value.split('\\n').length >= urls.length) break;
  }
  return JSON.stringify({ lines: value.split('\\n') });
})()`
}

/** The canonical product URL (with its slug): the link builder rejects bare /p/MLM… URLs. */
export function canonicalUrlExpression(url: string): string {
  return `(async () => {
  try {
    const response = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    const html = await response.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    return JSON.stringify({ status: response.status, canonical: canonical ? canonical[1] : null, unavailable: /no est. disponible/.test(html) });
  } catch (error) {
    return JSON.stringify({ status: 0, canonical: null, unavailable: false });
  }
})()`
}

/** The search page for a product name: listado.mercadolibre.com.mx/<words-joined-by-dashes>. */
export function searchUrl(query: string): string {
  const slug = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `https://listado.mercadolibre.com.mx/${slug}`
}

/** The first results of a search page: title, clean product URL, price and seller. */
export const SEARCH_RESULTS_EXPRESSION = `JSON.stringify([...document.querySelectorAll('.poly-card')].slice(0, 8).map((card) => {
  const link = card.querySelector('a.poly-component__title, .poly-component__title a, a');
  const fraction = card.querySelector('.poly-price__current .andes-money-amount__fraction');
  const cents = card.querySelector('.poly-price__current .andes-money-amount__cents');
  return {
    title: ((card.querySelector('.poly-component__title') || {}).textContent || '').trim(),
    url: link ? link.href.split('#')[0] : null,
    price: fraction ? Number(fraction.textContent.replace(/[.,]/g, '') + (cents ? '.' + cents.textContent.trim() : '')) : null,
    seller: ((card.querySelector('.poly-component__seller') || {}).textContent || '').trim().replace(/^Por /, '') || null,
    imageUrl: (() => { const img = card.querySelector('img'); return img ? (img.getAttribute('data-src') || img.currentSrc || img.src || null) : null })()
  };
// Sponsored results link to a click tracker, not to the product: never a link to keep.
}).filter((result) => result.url && result.title && !/^https:\\/\\/click\\d*\\.mercadolibre\\./.test(result.url)))`
