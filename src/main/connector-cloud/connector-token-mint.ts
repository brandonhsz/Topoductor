// Connector tokens for the desktop's signed-in Topo account, fetched the way relay tokens are.
import { z } from 'zod'
import type { TopoCloudAuthConfig } from '../topo-profiles/profile-cloud-auth-config'
import { TopoCloudRequestError } from '../topo-profiles/profile-cloud-client'
import { runWithFreshTopoCloudSession } from '../topo-profiles/profile-cloud-session-refresh'
import { ensureActiveTopoProfile } from '../topo-profiles/profile-index-store'
import { loadOrCreateHostInstallationId } from '../runtime/hosts/platform-probe/host-descriptor'
import { requestConnector, type ConnectorFailure } from './connector-cloud-request'
import type { ConnectorTokenMint } from './connector-transport'

const ConnectorTokenResponse = z.object({
  connectorToken: z
    .string()
    .min(1)
    .max(8 * 1024),
  expiresAt: z.number().int().positive()
})

const SIGNED_OUT: ConnectorFailure = {
  ok: false,
  status: 401,
  error: 'signed_out',
  retryAfterMs: null
}

/** The account the connector serves, read like the relay's: the active profile's cloud user. */
export function connectorAccount(userDataPath: string): string | null {
  return ensureActiveTopoProfile(userDataPath).profile.cloud?.userId ?? null
}

/** Mints only for `account`; after a switch or sign-out the old client gets no token for the new one. */
export function desktopConnectorTokenMint(
  authConfig: TopoCloudAuthConfig,
  userDataPath: string,
  account: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): ConnectorTokenMint {
  return async () => {
    if (connectorAccount(userDataPath) !== account) {
      return SIGNED_OUT
    }
    const active = ensureActiveTopoProfile(userDataPath)
    try {
      // The per-install id the host descriptor already keeps; the cloud keys this machine on it.
      const machineId = await loadOrCreateHostInstallationId(userDataPath)
      const minted = await runWithFreshTopoCloudSession(
        authConfig,
        active,
        userDataPath,
        async (session) => {
          const answer = await requestConnector(
            {
              fetchImpl,
              url: authConfig.connectorTokenEndpoint,
              body: { machineId },
              token: session.accessToken
            },
            ConnectorTokenResponse
          )
          // Refreshes the Topo session once, as every desktop cloud call does.
          if (!answer.ok && (answer.status === 401 || answer.status === 403)) {
            throw new TopoCloudRequestError(answer.status, answer.error ?? undefined)
          }
          return answer
        }
      )
      return minted.status === 'ok' && connectorAccount(userDataPath) === account
        ? minted.value
        : SIGNED_OUT
    } catch (error) {
      return {
        ok: false,
        status: error instanceof TopoCloudRequestError ? error.statusCode : null,
        error: null,
        retryAfterMs: null
      }
    }
  }
}
