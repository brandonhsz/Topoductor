// Solo relay host auth: the push gateway's desktop-like answerer completes the challenge, and the
// minted token passes the edge's own relay JWT check with the identity the desktop expects.
import { exportJWK, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  answerPushHostChallenge,
  createPushHostKeypair,
  hostPublicKeyB64,
  type PushHostKeypair
} from '../../push/src/host-challenge-answering.test-fixture'
import { deriveHostFingerprint } from '../../push/src/host-fingerprint'
import { verifyRelayJwt } from '../src/jwt'
import { handleSoloRoute } from '../src/solo/solo-director'
import type { SoloEnv } from '../src/solo/solo-env'
import { issueSoloChallenge, verifySoloProof } from '../src/solo/solo-host-auth'

const ORIGIN = 'https://relay.test.invalid'
let env: SoloEnv
let host: PushHostKeypair
let hostId: string

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'solo-1', alg: 'ES256', use: 'sig' }
  host = createPushHostKeypair(7)
  hostId = deriveHostFingerprint(host.publicKey)
  env = {
    RELAY_JWT_AUDIENCE: 'topo-relay',
    RELAY_JWKS: JSON.stringify({ keys: [publicJwk] }),
    RELAY_SIGNING_JWK: JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: 'solo-1' }),
    SOLO_CHALLENGE_KEY: 'k'.repeat(40),
    SOLO_ALLOWED_HOST_IDS: ` ${hostId} ,not-a-host-id`
  } as SoloEnv
})

async function post(path: string, body: unknown, origin = ORIGIN): Promise<Response> {
  const response = await handleSoloRoute(
    new Request(`${origin}${path}`, { method: 'POST', body: JSON.stringify(body) }),
    env
  )
  if (!response) { throw new Error('not a solo route') }
  return response
}

async function challengeFor(keypair: PushHostKeypair, origin = ORIGIN) {
  const response = await post('/v1/host/challenge', { v: 1, hostPublicKeyB64: hostPublicKeyB64(keypair) }, origin)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('solo host auth', () => {
  it('mints a relay token the edge accepts, with the desktop identity', async () => {
    const challenge = await challengeFor(host)
    expect(challenge.status).toBe(200)
    expect(String(challenge.body.challengeId).length).toBeLessThanOrEqual(128)
    const proofB64 = answerPushHostChallenge(challenge.body as never, { gatewayOrigin: ORIGIN, keypair: host })
    expect(proofB64).not.toBeNull()
    const session = await post('/v1/host/session', { v: 1, challengeId: challenge.body.challengeId, proofB64 })
    expect(session.status).toBe(200)
    const { relayToken, expiresAt } = (await session.json()) as { relayToken: string; expiresAt: number }
    expect(expiresAt).toBeGreaterThan(Date.now())
    const verified = await verifyRelayJwt(env, relayToken)
    expect(verified).toMatchObject({
      ok: true,
      claims: { userId: `host:${hostId}`, profileId: 'solo', organizationId: '', relayHostId: hostId }
    })
  })

  it('refuses a host that is not on the allowlist', async () => {
    expect((await challengeFor(createPushHostKeypair(8))).status).toBe(400)
  })

  it('refuses a proof for another origin, a forged id and an expired challenge', async () => {
    const challenge = await challengeFor(host)
    // The desktop itself refuses a challenge naming an origin it did not dial.
    expect(answerPushHostChallenge(challenge.body as never, { gatewayOrigin: 'https://other.invalid', keypair: host })).toBeNull()
    const proofB64 = answerPushHostChallenge(challenge.body as never, { gatewayOrigin: ORIGIN, keypair: host })
    const id = String(challenge.body.challengeId)
    expect(await verifySoloProof(env, 'https://other.invalid', { v: 1, challengeId: id, proofB64 })).toBeNull()
    const forged = `${id.slice(0, -1)}${id.endsWith('A') ? 'B' : 'A'}`
    expect(await verifySoloProof(env, ORIGIN, { v: 1, challengeId: forged, proofB64 })).toBeNull()
    expect(await verifySoloProof(env, ORIGIN, { v: 1, challengeId: id, proofB64 }, Date.now() + 60_000)).toBeNull()
    expect(await verifySoloProof(env, ORIGIN, { v: 1, challengeId: id, proofB64 })).toBe(hostId)
  })

  it('refuses a proof from a key that does not hold the host secret', async () => {
    const issued = await issueSoloChallenge(env, ORIGIN, { v: 1, hostPublicKeyB64: hostPublicKeyB64(host) })
    const impostor = { publicKey: host.publicKey, secretKey: createPushHostKeypair(9).secretKey }
    expect(answerPushHostChallenge(issued as never, { gatewayOrigin: ORIGIN, keypair: impostor })).toBeNull()
  })

  it('leaves every other path to the edge', async () => {
    expect(await handleSoloRoute(new Request(`${ORIGIN}/v1/host/control`), env)).toBeNull()
  })
})
