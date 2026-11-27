import { describe, expect, it } from 'vitest'
import {
  buildPushChallengeFixture,
  createPushHostKeypair
} from '../push/push-host-challenge-fixtures'
import { deriveRelayHostId, RelayHttpError } from './relay-http-client'
import {
  exchangeRelayHostKeyAuthorization,
  soloRelayAuthContext
} from './relay-host-key-authorization'

const RELAY_URL = 'https://relay-solo.example.workers.dev'
const NOW = 1_770_000_000_000
const now = (): number => NOW

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function relay(
  options: { challengeOrigin?: string; challengeStatus?: number; retryAfter?: string } = {}
) {
  const keypair = createPushHostKeypair()
  const calls: string[] = []
  let proof: string | null = null
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    calls.push(String(input))
    if (String(input).endsWith('/v1/host/challenge')) {
      if (options.challengeStatus) {
        const headers = options.retryAfter ? { 'retry-after': options.retryAfter } : undefined
        return jsonResponse(options.challengeStatus, { error: 'refused' }, headers)
      }
      const built = buildPushChallengeFixture({
        hostKeypair: keypair,
        gatewayOrigin: options.challengeOrigin ?? RELAY_URL,
        hostFingerprint: deriveRelayHostId(keypair.publicKey),
        issuedAt: NOW
      })
      proof = built.proof
      return jsonResponse(200, built.challenge)
    }
    const body: unknown = JSON.parse(String(init?.body))
    const proven =
      typeof body === 'object' && body !== null && 'proofB64' in body && body.proofB64 === proof
    return proven
      ? jsonResponse(200, { relayToken: 'relay-jwt', expiresAt: NOW + 300_000 })
      : jsonResponse(401, { error: 'invalid_proof' })
  }
  return { keypair, calls, fetchImpl }
}

describe('exchangeRelayHostKeyAuthorization', () => {
  it('answers the relay challenge with the host key and returns its relay token', async () => {
    const { keypair, calls, fetchImpl } = relay()
    const authorization = await exchangeRelayHostKeyAuthorization({
      relayUrl: RELAY_URL,
      keypair,
      fetch: fetchImpl,
      now
    })
    expect(authorization.relayToken).toBe('relay-jwt')
    expect(calls).toEqual([`${RELAY_URL}/v1/host/challenge`, `${RELAY_URL}/v1/host/session`])
  })

  it('refuses a challenge sealed for another origin without sending a proof', async () => {
    const { keypair, calls, fetchImpl } = relay({ challengeOrigin: 'https://elsewhere.invalid' })
    const error = await exchangeRelayHostKeyAuthorization({
      relayUrl: RELAY_URL,
      keypair,
      fetch: fetchImpl,
      now
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RelayHttpError)
    expect(error).toMatchObject({ statusCode: 401 })
    expect(calls).toHaveLength(1)
  })

  it('carries the relay refusal status and Retry-After', async () => {
    const { keypair, fetchImpl } = relay({ challengeStatus: 429, retryAfter: '7' })
    const error = await exchangeRelayHostKeyAuthorization({
      relayUrl: RELAY_URL,
      keypair,
      fetch: fetchImpl,
      now
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ statusCode: 429, retryAfterMs: 7000 })
  })
})

describe('soloRelayAuthContext', () => {
  it('is the identity the solo relay mints tokens for, without a cloud session', () => {
    expect(soloRelayAuthContext('AAAAAAAAAAAAAAAA')).toEqual({
      identity: { userId: 'host:AAAAAAAAAAAAAAAA', profileId: 'solo', organizationId: '' },
      accessToken: '',
      relayEntitled: true
    })
  })
})
