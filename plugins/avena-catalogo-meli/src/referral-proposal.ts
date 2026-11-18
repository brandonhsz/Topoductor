import type { CardReading, MeliClient, ReferralResult } from './meli-browser'
import type { ReferralProposal } from './protocol'

const GENERIC_LIST = 'El referido abre la lista genérica del afiliado, no el producto'

// MercadoLibre's link-builder messages, said in a line someone can act on.
const SHORT_REASONS: [RegExp, string][] = [
  [/no cumple con los requisitos/i, 'No entra al programa de afiliados (depende del vendedor)'],
  [/no está permitida/i, 'URL no permitida en el programa de afiliados'],
  [/pausado/i, 'La publicación está pausada'],
  [/no es de Mercado Libre/i, 'MercadoLibre no reconoce la URL']
]

export function shortReason(reason: string | null): string {
  const text = (reason ?? '').replace(/^⚠️\s*/, '').trim()
  return (
    SHORT_REASONS.find(([pattern]) => pattern.test(text))?.[1] ??
    (text || 'MercadoLibre no respondió')
  )
}

/** The builder rejects bare /p/MLM… URLs as foreign; their canonical URL (with slug) works. */
async function retryForeign(
  client: MeliClient,
  results: ReferralResult[]
): Promise<ReferralResult[]> {
  const retried = new Map<string, ReferralResult>()
  const canonicalOf = new Map<string, string>()
  for (const result of results) {
    if (result.referral || !/no es de Mercado Libre/i.test(result.reason ?? '')) {
      continue
    }
    const page = await client.canonicalUrl(result.url)
    if (page.status === 404) {
      retried.set(result.url, { ...result, reason: 'La página ya no existe en MercadoLibre' })
    } else if (page.unavailable) {
      retried.set(result.url, {
        ...result,
        reason: 'El producto no está disponible en MercadoLibre'
      })
    } else if (page.canonical) {
      canonicalOf.set(page.canonical, result.url)
    }
  }
  if (canonicalOf.size > 0) {
    for (const again of await client.generateReferrals([...canonicalOf.keys()])) {
      const original = canonicalOf.get(again.url) ?? again.url
      retried.set(original, { ...again, url: original })
    }
  }
  return results.map((result) => retried.get(result.url) ?? result)
}

/**
 * Asks the link builder for a meli.la per URL and checks each opens on its product, not on the
 * affiliate's generic list. Keyed by the URL asked for.
 */
export async function proposeReferrals(
  client: MeliClient,
  targets: readonly string[]
): Promise<Map<string, ReferralProposal>> {
  return (await proposeReferralsWithCards(client, targets)).proposals
}

/** The proposals plus each referral's featured card, whose price can be written right away. */
export async function proposeReferralsWithCards(
  client: MeliClient,
  targets: readonly string[]
): Promise<{ proposals: Map<string, ReferralProposal>; cards: Map<string, CardReading> }> {
  const results = await retryForeign(client, await client.generateReferrals(targets))
  const cards = new Map<string, CardReading>()
  const referrals = results.flatMap((result) => (result.referral ? [result.referral] : []))
  if (referrals.length > 0) {
    await client.readCards(referrals, async (batch) => {
      for (const card of batch) {
        cards.set(card.url, card)
      }
    })
  }
  const createdAt = Date.now()
  const proposals = new Map(
    results.map((result): [string, ReferralProposal] => {
      const card = result.referral ? cards.get(result.referral) : undefined
      if (!result.referral) {
        return [
          result.url,
          { url: null, reason: shortReason(result.reason), title: null, createdAt }
        ]
      }
      return [
        result.url,
        card?.ok
          ? {
              url: result.referral,
              reason: null,
              title: card.title,
              createdAt,
              image: card.imageUrl ?? null
            }
          : { url: null, reason: GENERIC_LIST, title: null, createdAt }
      ]
    })
  )
  return { proposals, cards }
}
