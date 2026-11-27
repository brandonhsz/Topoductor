// Host-key relay tokens: the push gateway's sealed challenge (push-contract), answered by the
// desktop's X25519 key, mints a relay JWT. No account; only allowlisted relayHostIds get one.
// Stateless: the challenge id carries the host key and expiry under a MAC, and the ephemeral key,
// nonce and secret derive from it, so the session step rebuilds the expected proof. A replayed
// proof only mints another token for the host that made it.
import nacl from 'tweetnacl'
import { SignJWT, importJWK, type JWK } from 'jose'
import {
  buildPushHostChallengePlaintext,
  buildPushHostProofMacInput,
  buildPushHostProofTranscript
} from '../../../../packages/push-contract/src/push-host-proof-transcript'
import {
  PushHostChallengeRequestSchema,
  PushHostSessionRequestSchema
} from '../../../../packages/push-contract/src/host-auth-messages'
import { PUSH_LIMITS } from '../../../../packages/push-contract/src/push-limits'
import { RELAY_PROTOCOL_LIMITS } from '../../../../packages/relay-contract/src/protocol-limits'
import { b64, b64url, fromB64, hmacSha256, sha256B64url, timingSafeEqualStr } from '../bytes'
import { SOLO_DEFAULT_ISSUER, SOLO_PROFILE_ID, soloAllowedHostIds, soloChallengeKey, soloUserId, type SoloEnv } from './solo-env'

const CHALLENGE_DOMAIN = 'topo-relay-solo-challenge/v1\0'
const CHALLENGE_ID = /^([A-Za-z0-9_-]{43})\.([0-9a-z]{1,11})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/

export type SoloChallenge = {
  challengeId: string
  gatewayEphemeralPublicKeyB64: string
  nonceB64: string
  ciphertextB64: string
  expiresAt: number
}

export type SoloRelayToken = { relayToken: string; relayHostId: string; expiresAt: number }

async function derive(env: SoloEnv, label: string, unsigned: string): Promise<Uint8Array> {
  return hmacSha256(soloChallengeKey(env), new TextEncoder().encode(`${CHALLENGE_DOMAIN}${label}\0${unsigned}`))
}

async function hostIdFor(hostPublicKey: Uint8Array): Promise<string> {
  return (await sha256B64url(hostPublicKey)).slice(0, 16)
}

type ChallengeParts = {
  challengeId: string
  hostPublicKey: Uint8Array
  relayHostId: string
  expiresAt: number
  ephemeral: nacl.BoxKeyPair
  nonce: Uint8Array
  secret: Uint8Array
  transcript: Uint8Array
}

async function challengeParts(env: SoloEnv, origin: string, unsigned: string, hostPublicKey: Uint8Array, expiresAt: number): Promise<ChallengeParts> {
  const challengeId = `${unsigned}.${b64url(await derive(env, 'id', unsigned))}`
  const ephemeral = nacl.box.keyPair.fromSecretKey(await derive(env, 'ephemeral', unsigned))
  const nonce = (await derive(env, 'nonce', unsigned)).slice(0, nacl.box.nonceLength)
  const secret = await derive(env, 'secret', unsigned)
  const relayHostId = await hostIdFor(hostPublicKey)
  const transcript = buildPushHostProofTranscript({
    gatewayOrigin: origin,
    gatewayEphemeralPublicKey: ephemeral.publicKey,
    challengeNonce: nonce,
    challengeId,
    issuedAt: expiresAt - PUSH_LIMITS.challengeTtlMs,
    expiresAt,
    hostFingerprint: relayHostId,
    hostPublicKey
  })
  return { challengeId, hostPublicKey, relayHostId, expiresAt, ephemeral, nonce, secret, transcript }
}

export async function issueSoloChallenge(env: SoloEnv, origin: string, raw: unknown, now = Date.now()): Promise<SoloChallenge | null> {
  const body = PushHostChallengeRequestSchema.safeParse(raw)
  if (!body.success) { return null }
  const hostPublicKey = fromB64(body.data.hostPublicKeyB64)
  if (!soloAllowedHostIds(env).has(await hostIdFor(hostPublicKey))) { return null }
  const expiresAt = now + PUSH_LIMITS.challengeTtlMs
  const unsigned = `${b64url(hostPublicKey)}.${expiresAt.toString(36)}.${b64url(nacl.randomBytes(16))}`
  const parts = await challengeParts(env, origin, unsigned, hostPublicKey, expiresAt)
  const ciphertext = nacl.box(
    buildPushHostChallengePlaintext(parts.transcript, parts.secret),
    parts.nonce,
    hostPublicKey,
    parts.ephemeral.secretKey
  )
  return {
    challengeId: parts.challengeId,
    gatewayEphemeralPublicKeyB64: b64(parts.ephemeral.publicKey),
    nonceB64: b64(parts.nonce),
    ciphertextB64: b64(ciphertext),
    expiresAt
  }
}

// The relayHostId whose key answered the challenge, or null for any failure.
export async function verifySoloProof(env: SoloEnv, origin: string, raw: unknown, now = Date.now()): Promise<string | null> {
  const body = PushHostSessionRequestSchema.safeParse(raw)
  if (!body.success) { return null }
  const match = CHALLENGE_ID.exec(body.data.challengeId)
  if (!match) { return null }
  const [, hostKeyB64url, expiresAt36, random] = match
  const unsigned = `${hostKeyB64url}.${expiresAt36}.${random}`
  const expectedId = `${unsigned}.${b64url(await derive(env, 'id', unsigned))}`
  if (!timingSafeEqualStr(expectedId, body.data.challengeId)) { return null }
  const expiresAt = parseInt(expiresAt36, 36)
  if (!Number.isSafeInteger(expiresAt) || now > expiresAt) { return null }
  const hostPublicKey = fromB64(hostKeyB64url)
  if (hostPublicKey.byteLength !== 32) { return null }
  const parts = await challengeParts(env, origin, unsigned, hostPublicKey, expiresAt)
  // Re-checked: a host removed from the list must not finish a challenge issued before.
  if (!soloAllowedHostIds(env).has(parts.relayHostId)) { return null }
  const expected = b64(await hmacSha256(parts.secret, buildPushHostProofMacInput(parts.transcript)))
  return timingSafeEqualStr(expected, body.data.proofB64) ? parts.relayHostId : null
}

export async function mintSoloRelayToken(env: SoloEnv, relayHostId: string, now = Date.now()): Promise<SoloRelayToken> {
  if (!env.RELAY_SIGNING_JWK) { throw new Error('relay_solo_config_signing_key') }
  const jwk = JSON.parse(env.RELAY_SIGNING_JWK) as JWK
  const key = await importJWK(jwk, 'ES256')
  const expiresAt = now + RELAY_PROTOCOL_LIMITS.relayTokenTtlMs
  const relayToken = await new SignJWT({ prof: SOLO_PROFILE_ID, relayHostId, purpose: 'host-control' })
    .setProtectedHeader({ alg: 'ES256', ...(jwk.kid ? { kid: jwk.kid } : {}) })
    .setSubject(soloUserId(relayHostId))
    .setIssuer(env.RELAY_AUTH_ISSUER ?? SOLO_DEFAULT_ISSUER)
    .setAudience(env.RELAY_JWT_AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key)
  return { relayToken, relayHostId, expiresAt: Math.floor(expiresAt / 1000) * 1000 }
}
