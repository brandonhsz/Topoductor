import { randomBytes } from 'node:crypto'
import type { TopoCloudAuthConfig } from './profile-cloud-auth-config'
import {
  TOPO_CLOUD_CALLBACK_RESPONSE_HEADERS,
  TOPO_CLOUD_CALLBACK_SUCCESS_PAGE
} from './profile-cloud-callback-page'
import { base64Url, beginLoopbackPkceAuthorization } from '../oauth/loopback-pkce-authorization'

export type TopoCloudAuthorizationCode = {
  code: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  state: string
}

export async function beginTopoCloudPkceFlow(
  config: TopoCloudAuthConfig,
  localProfileId: string,
  options: { onAuthorizeUrl?: (url: string) => void; signal?: AbortSignal } = {}
): Promise<TopoCloudAuthorizationCode> {
  const nonce = base64Url(randomBytes(32))
  const authorization = await beginLoopbackPkceAuthorization({
    errorPrefix: 'topo_cloud_auth',
    successPage: TOPO_CLOUD_CALLBACK_SUCCESS_PAGE,
    successHeaders: TOPO_CLOUD_CALLBACK_RESPONSE_HEADERS,
    onAuthorizeUrl: options.onAuthorizeUrl,
    signal: options.signal,
    buildAuthorizeUrl: ({ redirectUri, state, codeChallenge }) => {
      const authorizeUrl = new URL(config.authorizeEndpoint)
      authorizeUrl.searchParams.set('client_id', config.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('scope', config.scope)
      authorizeUrl.searchParams.set('nonce', nonce)
      authorizeUrl.searchParams.set('state', state)
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('local_profile_id', localProfileId)
      return authorizeUrl
    }
  })
  return { ...authorization, nonce }
}
