// Self-hosted relays (cloud/apps/relay-edge/src/solo): prove the host's E2EE key with the push gateway's sealed challenge instead of exchanging a Topo Cloud session.
import { z } from 'zod'
import type { E2EEKeypair } from '../rpc/server/pairing/e2ee-keypair'
import { answerPushHostChallenge } from '../push/push-host-proof'
import { cancelUnreadResponseBody } from '../../lib/unread-response-body'
import { parseRetryAfterHeaderMs } from '../../../shared/retry-after-header'
import { deriveRelayHostId, RelayHttpError, type RelayAuthorization } from './relay-http-client'
import type { RelayAuthContext } from './relay-auth-identity'

const REQUEST_DEADLINE_MS = 15_000
const RETRY_AFTER_MAX_MS = 5 * 60_000

const ChallengeSchema = z
  .object({
    challengeId: z.string().min(1).max(512),
    gatewayEphemeralPublicKeyB64: z.string().min(1).max(128),
    nonceB64: z.string().min(1).max(128),
    ciphertextB64: z
      .string()
      .min(1)
      .max(8 * 1024),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

const TokenSchema = z
  .object({
    relayToken: z
      .string()
      .min(1)
      .max(8 * 1024),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

// Must match the solo relay's token claims (cloud/apps/relay-edge/src/solo/solo-env.ts): the host proof transcript carries them.
export function soloRelayAuthContext(relayHostId: string): RelayAuthContext {
  return {
    identity: { userId: `host:${relayHostId}`, profileId: 'solo', organizationId: '' },
    accessToken: '',
    relayEntitled: true
  }
}

async function postRelayJson<TSchema extends z.ZodType>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  body: unknown,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_DEADLINE_MS),
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const retryAfterMs = parseRetryAfterHeaderMs(
      response.headers.get('retry-after'),
      RETRY_AFTER_MAX_MS
    )
    await cancelUnreadResponseBody(response)
    throw new RelayHttpError('token-exchange', response.status, retryAfterMs)
  }
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new RelayHttpError('token-exchange', 502)
  }
  return parsed.data
}

export async function exchangeRelayHostKeyAuthorization(input: {
  relayUrl: string
  keypair: E2EEKeypair
  fetch?: typeof globalThis.fetch
  now?: () => number
}): Promise<RelayAuthorization> {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const challenge = await postRelayJson(
    fetchImpl,
    `${input.relayUrl}/v1/host/challenge`,
    { v: 1, hostPublicKeyB64: input.keypair.publicKeyB64 },
    ChallengeSchema
  )
  const proofB64 = answerPushHostChallenge(challenge, {
    gatewayOrigin: input.relayUrl,
    hostFingerprint: deriveRelayHostId(input.keypair.publicKey),
    hostPublicKey: input.keypair.publicKey,
    hostSecretKey: input.keypair.secretKey,
    now: input.now
  })
  if (!proofB64) {
    // A challenge this host cannot answer is a refusal, never retried as a dropped packet.
    throw new RelayHttpError('token-exchange', 401)
  }
  return await postRelayJson(
    fetchImpl,
    `${input.relayUrl}/v1/host/session`,
    { v: 1, challengeId: challenge.challengeId, proofB64 },
    TokenSchema
  )
}
