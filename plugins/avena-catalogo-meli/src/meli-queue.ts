// Every MercadoLibre client the worker hands out goes through the flow queue.
import type { FlowQueue } from './flow-queue'
import type { MeliClient } from './meli-browser'

export function queuedMeli(client: MeliClient, queue: FlowQueue): MeliClient {
  return {
    readCards: (urls, onBatch) =>
      queue.run('Leer precios en ML', () => client.readCards(urls, onBatch)),
    generateReferrals: (urls) =>
      queue.run('Generar referidos', () => client.generateReferrals(urls)),
    canonicalUrl: (url) => queue.run('Revisar un link', () => client.canonicalUrl(url)),
    search: (query) => queue.run('Buscar en MercadoLibre', () => client.search(query))
  }
}
