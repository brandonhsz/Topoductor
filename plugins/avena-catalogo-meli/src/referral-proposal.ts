import type { MeliClient } from './meli-browser'
import type { ReferralProposal } from './protocol'

/** Asks the link builder for a meli.la and checks it opens on the product, not the generic list. */
export async function proposeReferral(
  client: MeliClient,
  target: string
): Promise<ReferralProposal> {
  let [result] = await client.generateReferrals([target])
  // The builder rejects bare /p/MLM… URLs as foreign; their canonical URL (with slug) works.
  if (!result.referral && /no es de Mercado Libre/i.test(result.reason ?? '')) {
    const page = await client.canonicalUrl(target)
    if (page.status === 404) {
      result = { ...result, reason: 'La página ya no existe en MercadoLibre' }
    } else if (page.unavailable) {
      result = { ...result, reason: 'El producto no está disponible en MercadoLibre' }
    } else if (page.canonical) {
      ;[result] = await client.generateReferrals([page.canonical])
    }
  }
  if (!result.referral) {
    return { url: null, reason: result.reason, title: null, createdAt: Date.now() }
  }
  let card: { ok: boolean; title: string | null } | undefined
  await client.readCards([result.referral], async (batch) => {
    card = batch[0]
  })
  return card?.ok
    ? { url: result.referral, reason: null, title: card.title, createdAt: Date.now() }
    : {
        url: null,
        reason: 'El referido se generó pero cae en la lista genérica, no en el producto',
        title: null,
        createdAt: Date.now()
      }
}
