// Writes go through the configured backend endpoint (PATCH, admin Basic auth) so the backend
// recalculates adjustedPrice; the Mongo user is read-only.

export type SupplementUpdate = {
  id: string
  price?: number
  productURL?: string
  hasStock?: boolean
  listPrice?: number
  discountPercentage?: number
  mlItemId?: string
  priceCheckedAt?: string
}

export type BackendCredentials = { baseUrl: string; path: string; email: string; password: string }

import { records } from './json-fields'

type Fetch = typeof fetch

const BATCH = 45

export async function patchSupplements(
  credentials: BackendCredentials,
  updates: readonly SupplementUpdate[],
  fetchImpl: Fetch = fetch
): Promise<{ id: string }[]> {
  const endpoint = new URL(credentials.path, credentials.baseUrl).toString()
  const authorization = `Basic ${Buffer.from(`${credentials.email}:${credentials.password}`).toString('base64')}`
  const written: { id: string }[] = []
  for (let index = 0; index < updates.length; index += BATCH) {
    const response = await fetchImpl(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify(updates.slice(index, index + BATCH))
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'El backend rechazó la cuenta: debe ser un usuario admin.'
          : `El backend respondió ${response.status}${detail ? `: ${detail}` : ''}`
      )
    }
    const body: unknown = await response.json()
    written.push(...records(body).map((supplement) => ({ id: String(supplement.id) })))
  }
  return written
}
