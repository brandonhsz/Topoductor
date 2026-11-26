import type { AvenaPMConnectionStatus } from '../../shared/avenapm/avenapm-types'
import { beginLoopbackPkceAuthorization } from '../oauth/loopback-pkce-authorization'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { readUser, requestJson, resolveBaseUrl } from './avenapm-http'
import {
  TOPO_CLOUD_CALLBACK_RESPONSE_HEADERS,
  TOPO_CLOUD_CALLBACK_SUCCESS_PAGE
} from '../topo-profiles/profile-cloud-callback-page'
import {
  clearAvenaPMCredential,
  readAvenaPMCredential,
  saveAvenaPMCredential
} from './avenapm-credential-store'

let connectAbort: AbortController | null = null

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

export { listAvenaPMTasks } from './avenapm-task-queue'
