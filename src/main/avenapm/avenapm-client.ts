import {
  AVENAPM_DEFAULT_BASE_URL,
  type AvenaPMConnectionStatus,
  type AvenaPMListTasksArgs,
  type AvenaPMListTasksResult,
  type AvenaPMTask,
  type AvenaPMUser
} from '../../shared/avenapm/avenapm-types'
import { beginLoopbackPkceAuthorization } from '../oauth/loopback-pkce-authorization'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import {
  TOPO_CLOUD_CALLBACK_RESPONSE_HEADERS,
  TOPO_CLOUD_CALLBACK_SUCCESS_PAGE
} from '../topo-profiles/profile-cloud-callback-page'
import {
  clearAvenaPMCredential,
  readAvenaPMCredential,
  saveAvenaPMCredential
} from './avenapm-credential-store'

const REQUEST_TIMEOUT_MS = 20_000

// Why env override: lets a local avena-pm (`next dev`) stand in for production while developing.
function resolveBaseUrl(): string {
  const override = process.env.TOPO_AVENAPM_URL?.trim()
  return (override || AVENAPM_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

let connectAbort: AbortController | null = null

async function requestJson(
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

function readUser(value: unknown): AvenaPMUser | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.email !== 'string') {
    return null
  }
  return { email: raw.email, name: typeof raw.name === 'string' ? raw.name : raw.email }
}

export function getAvenaPMStatus(): AvenaPMConnectionStatus {
  const credential = readAvenaPMCredential()
  if (!credential) {
    return { connected: false, baseUrl: resolveBaseUrl() }
  }
  return { connected: true, baseUrl: credential.baseUrl, user: credential.user }
}

/** Signs in through the AvenaPM Google login in the system browser and stores a personal token. */
export async function connectAvenaPM(): Promise<AvenaPMConnectionStatus> {
  connectAbort?.abort()
  const abort = new AbortController()
  connectAbort = abort
  const baseUrl = resolveBaseUrl()
  try {
    const authorization = await beginLoopbackPkceAuthorization({
      errorPrefix: 'avenapm_auth',
      successPage: TOPO_CLOUD_CALLBACK_SUCCESS_PAGE,
      successHeaders: TOPO_CLOUD_CALLBACK_RESPONSE_HEADERS,
      signal: abort.signal,
      buildAuthorizeUrl: ({ redirectUri, state, codeChallenge }) => {
        const url = new URL(`${baseUrl}/api/app/autorizar`)
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('redirect_uri', redirectUri)
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('code_challenge_method', 'S256')
        return url
      }
    })
    const { status, body } = await requestJson(`${baseUrl}/api/app/token`, {
      method: 'POST',
      body: {
        grant_type: 'authorization_code',
        code: authorization.code,
        code_verifier: authorization.codeVerifier,
        redirect_uri: authorization.redirectUri,
        client_name: 'Topo'
      }
    })
    const payload = asRecord(body)
    const token = payload?.access_token
    const user = readUser(payload?.usuario)
    if (status !== 200 || typeof token !== 'string' || !user) {
      throw new Error(`AvenaPM sign-in failed (${status}).`)
    }
    saveAvenaPMCredential({ baseUrl, token, user })
    return { connected: true, baseUrl, user }
  } finally {
    if (connectAbort === abort) {
      connectAbort = null
    }
  }
}

export function cancelAvenaPMConnect(): void {
  connectAbort?.abort()
}

export async function disconnectAvenaPM(): Promise<AvenaPMConnectionStatus> {
  const credential = readAvenaPMCredential()
  clearAvenaPMCredential()
  if (credential) {
    // Server-side revocation is best-effort; the local token is already gone.
    await requestJson(`${credential.baseUrl}/api/app/token`, {
      method: 'DELETE',
      token: credential.token
    }).catch(() => undefined)
  }
  return { connected: false, baseUrl: resolveBaseUrl() }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapTask(value: unknown, baseUrl: string): AvenaPMTask | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') {
    return null
  }
  const priority = typeof raw.priority === 'number' ? raw.priority : Number(raw.priority)
  return {
    id: raw.id,
    shortId: stringOrNull(raw.idCorto),
    title: raw.title,
    description: stringOrNull(raw.description),
    status: stringOrNull(raw.status) ?? 'por_hacer',
    priority: Number.isFinite(priority) ? priority : null,
    size: stringOrNull(raw.size),
    classification: stringOrNull(raw.clasificacion) ?? 'sin_clasificar',
    assignee: readUser(raw.assignee),
    url: `${baseUrl}/tareas?tarea=${encodeURIComponent(raw.id)}`,
    createdAt: stringOrNull(raw.createdAt) ?? '',
    updatedAt: stringOrNull(raw.updatedAt) ?? ''
  }
}

export async function listAvenaPMTasks(
  args: AvenaPMListTasksArgs = {}
): Promise<AvenaPMListTasksResult> {
  const credential = readAvenaPMCredential()
  if (!credential) {
    return { ok: false, reason: 'not_connected', message: 'AvenaPM is not connected.' }
  }
  const url = new URL(`${credential.baseUrl}/api/app/cola`)
  if (args.status) {
    url.searchParams.set('status', args.status)
  }
  if (args.classification) {
    url.searchParams.set('clasificacion', args.classification)
  }
  if (args.includeClosed) {
    url.searchParams.set('incluirCerradas', '1')
  }
  try {
    const { status, body } = await requestJson(url.toString(), { token: credential.token })
    if (status === 401) {
      return {
        ok: false,
        reason: 'unauthorized',
        message: 'AvenaPM session expired. Sign in again.'
      }
    }
    if (status !== 200) {
      const error = asRecord(body)?.error
      return {
        ok: false,
        reason: 'request_failed',
        message: typeof error === 'string' ? error : `AvenaPM request failed (${status}).`
      }
    }
    const payload = asRecord(body)
    const rawTasks: unknown[] = Array.isArray(payload?.tareas) ? payload.tareas : []
    const queueName = asRecord(payload?.cola)?.name
    return {
      ok: true,
      queueName: typeof queueName === 'string' ? queueName : 'Operación',
      tasks: rawTasks
        .map((task) => mapTask(task, credential.baseUrl))
        .filter((task): task is AvenaPMTask => task !== null)
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'request_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
