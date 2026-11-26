import type { AvenaPMUser } from '../../shared/avenapm/avenapm-types'
import { AVENAPM_DEFAULT_BASE_URL } from '../../shared/avenapm/avenapm-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'

const REQUEST_TIMEOUT_MS = 20_000

// Why env override: lets a local avena-pm (`next dev`) stand in for production while developing.
export function resolveBaseUrl(): string {
  const override = process.env.TOPO_AVENAPM_URL?.trim()
  return (override || AVENAPM_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export async function requestJson(
  url: string,
  init: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.token) {
    headers.authorization = `Bearer ${init.token}`
  }
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

export function readUser(value: unknown): AvenaPMUser | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.email !== 'string') {
    return null
  }
  return { email: raw.email, name: typeof raw.name === 'string' ? raw.name : raw.email }
}
