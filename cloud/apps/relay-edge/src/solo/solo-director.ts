// Director and token routes for a single-cell relay: the Worker's own origin is both director and
// cell. Same wire shapes as cloud/apps/relay/src/app.ts (/v1/assign, /v1/resolve) and the push
// gateway's host auth (/v1/host/challenge, /v1/host/session), minus regions and migrations.
import { SignJWT } from 'jose'
import { z } from 'zod'
import { RELAY_PROTOCOL_LIMITS } from '../../../../packages/relay-contract/src/protocol-limits'
import { HOST_ID, readBearer, verifyRelayJwt } from '../jwt'
import { admitPreAuth } from '../preauth'
import { soloAllowedHostIds, soloChallengeKey, type SoloEnv } from './solo-env'
import { issueSoloChallenge, mintSoloRelayToken, verifySoloProof } from './solo-host-auth'
import type { SoloHostRelay } from './solo-host-relay'

const AssignRequestSchema = z.object({ v: z.literal(1), relayHostId: z.string().regex(HOST_ID) }).passthrough()
const ResolveRequestSchema = z
  .object({ v: z.literal(1), relayHostId: z.string().regex(HOST_ID), resumeToken: z.string().min(1).max(512) })
  .strict()

const SOLO_ROUTES = new Set(['/v1/host/challenge', '/v1/host/session', '/v1/assign', '/v1/resolve'])

function error(status: number, code: string, retryAfter?: number): Response {
  const headers = retryAfter === undefined ? undefined : { 'retry-after': String(retryAfter) }
  return Response.json({ error: code }, { status, headers })
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes) { return null }
  const text = await request.text()
  if (text.length > RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes) { return null }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function hostObject(env: SoloEnv, relayHostId: string) {
  const namespace = env.HOST_RELAY as unknown as DurableObjectNamespace<SoloHostRelay>
  return namespace.get(namespace.idFromName(relayHostId))
}

async function signLease(env: SoloEnv, origin: string, sub: string, relayHostId: string, assignmentEpoch: number): Promise<string> {
  return new SignJWT({ purpose: 'cell-assignment', cellId: env.EDGE_CELL_ID ?? 'edge', cellUrl: origin, assignmentEpoch, relayHostId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(origin)
    .setAudience('topo-relay-assignment')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(soloChallengeKey(env))
}

async function assign(env: SoloEnv, request: Request, origin: string): Promise<Response> {
  const token = readBearer(request.headers.get('authorization'))
  const verified = token ? await verifyRelayJwt(env, token) : null
  if (!verified?.ok) {
    return verified?.reason === 'keys_unavailable' ? error(503, 'unavailable', 5) : error(401, 'invalid_token')
  }
  const body = AssignRequestSchema.safeParse(await readJson(request))
  if (!body.success) { return error(400, 'invalid_request') }
  const { claims } = verified
  if (body.data.relayHostId !== claims.relayHostId) { return error(403, 'host_identity_mismatch') }
  if (!soloAllowedHostIds(env).has(claims.relayHostId)) { return error(403, 'host_not_allowed') }
  const assignmentEpoch = await hostObject(env, claims.relayHostId).soloAssign(claims.userId, claims.relayHostId)
  if (assignmentEpoch === null) { return error(503, 'assignment_unavailable', 5) }
  return Response.json({
    v: 1,
    cellUrl: origin,
    assignmentEpoch,
    lease: await signLease(env, origin, claims.userId, claims.relayHostId, assignmentEpoch)
  })
}

async function resolve(env: SoloEnv, request: Request, origin: string): Promise<Response> {
  const body = ResolveRequestSchema.safeParse(await readJson(request))
  if (!body.success) { return error(400, 'invalid_request') }
  const placement = await hostObject(env, body.data.relayHostId).soloResolve(body.data.relayHostId, body.data.resumeToken)
  if (!placement) { return error(401, 'invalid_credential') }
  return Response.json({ v: 1, cellUrl: origin, ...placement })
}

// A response for the solo routes, or null to hand the request to the edge.
export async function handleSoloRoute(request: Request, env: SoloEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!SOLO_ROUTES.has(url.pathname)) { return null }
  if (request.method !== 'POST' || url.search) { return error(404, 'not_found') }
  if (url.pathname !== '/v1/assign' && !(await admitPreAuth(env, request, 'solo'))) {
    return error(429, 'rate_limited', 60)
  }
  const origin = url.origin
  if (url.pathname === '/v1/assign') { return assign(env, request, origin) }
  if (url.pathname === '/v1/resolve') { return resolve(env, request, origin) }
  if (url.pathname === '/v1/host/challenge') {
    const challenge = await issueSoloChallenge(env, origin, await readJson(request))
    return challenge ? Response.json(challenge) : error(400, 'invalid_request')
  }
  const relayHostId = await verifySoloProof(env, origin, await readJson(request))
  if (!relayHostId) { return error(401, 'invalid_proof') }
  const { relayToken, expiresAt } = await mintSoloRelayToken(env, relayHostId)
  return Response.json({ relayToken, expiresAt })
}
