import type { Env } from '../env'
import { HOST_ID } from '../jwt'

// Single-owner relay: this Worker is its own director and token issuer (solo-worker.ts).
export type SoloEnv = Env & {
  // Private ES256 JWK (JSON, with kid) that signs host relay tokens; RELAY_JWKS holds its public half.
  RELAY_SIGNING_JWK?: string
  // HS256 key (>= 32 chars) for stateless challenge ids and assignment leases.
  SOLO_CHALLENGE_KEY?: string
  // Comma-separated relayHostIds allowed to get a relay token.
  SOLO_ALLOWED_HOST_IDS?: string
}

export const SOLO_PROFILE_ID = 'solo'
export const SOLO_DEFAULT_ISSUER = 'topo-relay-solo'

// Must match soloRelayIdentity on the desktop: the host proof transcript carries these claims.
export function soloUserId(relayHostId: string): string {
  return `host:${relayHostId}`
}

export function soloAllowedHostIds(env: SoloEnv): Set<string> {
  return new Set(
    (env.SOLO_ALLOWED_HOST_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => HOST_ID.test(id))
  )
}

export function soloChallengeKey(env: SoloEnv): Uint8Array {
  const key = env.SOLO_CHALLENGE_KEY ?? ''
  if (key.length < 32) { throw new Error('relay_solo_config_challenge_key') }
  return new TextEncoder().encode(key)
}
