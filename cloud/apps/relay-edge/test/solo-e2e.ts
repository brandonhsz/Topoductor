// Solo relay end to end in local workerd (wrangler.solo.example.jsonc): the SHIPPED desktop's
// host-key token exchange, director assignment and control client, a phone paired by invite, its
// resume, and /v1/resolve. Its own config and .dev.vars live under .wrangler/ (gitignored).
//   npx tsx test/solo-e2e.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJWK, generateKeyPair } from 'jose'
import { RelayPhoneHelloSchema } from '../../../../src/shared/remote-runtime/relay/mobile-relay-phone-protocol'
import { exchangeRelayHostKeyAuthorization, soloRelayAuthContext } from '../../../../src/main/runtime/mobile-cloud-relay/relay-host-key-authorization'
import { requestRelayAssignment } from '../../../../src/main/runtime/mobile-cloud-relay/relay-http-client'
import { ORIGIN, PORT, b64url, control, newHost, phoneOutcome, record, results, sha, sleep, waitFor } from './harness-mvp-object'

const root = new URL('..', import.meta.url).pathname
const configDir = join(root, '.wrangler', 'solo-e2e')

async function writeConfig(allowed: string[]): Promise<void> {
  const example = readFileSync(join(root, 'wrangler.solo.example.jsonc'), 'utf8')
  const config = JSON.parse(example.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')) as Record<string, unknown>
  delete config.$schema
  config.main = '../../src/solo/solo-worker.ts'
  config.alias = Object.fromEntries(
    Object.entries(config.alias as Record<string, string>).map(([name, path]) => [name, `../../${path}`])
  )
  config.vars = { ...(config.vars as Record<string, string>), PING_INTERVAL_MS: '3000', SILENCE_TIMEOUT_MS: '9000' }
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'wrangler.jsonc'), JSON.stringify(config, null, 2))
  const pair = await generateKeyPair('ES256', { extractable: true })
  const secrets = {
    RELAY_SIGNING_JWK: JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: 'solo-e2e', alg: 'ES256' }),
    RELAY_JWKS: JSON.stringify({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'solo-e2e', alg: 'ES256', use: 'sig' }] }),
    SOLO_CHALLENGE_KEY: randomBytes(32).toString('base64url'),
    ADMIN_SIGNING_KEY: randomBytes(32).toString('base64url'),
    SOLO_ALLOWED_HOST_IDS: allowed.join(',')
  }
  writeFileSync(
    join(configDir, '.dev.vars'),
    Object.entries(secrets).map(([name, value]) => `${name}='${value}'`).join('\n')
  )
}

// The allowlist is fixed at boot: the host exists before the Worker starts.
const host = newHost()
const stranger = newHost()

async function flow(): Promise<void> {
  const id = host.relayHostId
  const refused = await exchangeRelayHostKeyAuthorization({ relayUrl: ORIGIN, keypair: stranger.keypair as never }).catch((e: Error & { statusCode?: number }) => e)
  record('S1 a host outside the allowlist gets no token', refused instanceof Error && 'statusCode' in refused && refused.statusCode === 400, String((refused as { statusCode?: number }).statusCode))

  const { relayToken, expiresAt } = await exchangeRelayHostKeyAuthorization({ relayUrl: ORIGIN, keypair: host.keypair as never })
  record('S1 shipped desktop exchange: host key answers the challenge, relay token minted', relayToken.length > 0 && expiresAt > Date.now(), `expiresIn=${Math.round((expiresAt - Date.now()) / 1000)}s`)

  const assignment = await requestRelayAssignment({ directorUrl: ORIGIN, relayToken, relayHostId: id, reconnect: true })
  record('S2 /v1/assign places the host on this Worker (strict desktop parser)', assignment.cellUrl === ORIGIN && assignment.assignmentEpoch === 1, JSON.stringify({ cellUrl: assignment.cellUrl, epoch: assignment.assignmentEpoch }))
  const again = await fetch(`${ORIGIN}/v1/assign`, { method: 'POST', headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, relayHostId: id }) })
  const againBody = (await again.json()) as { assignmentEpoch?: number }
  const otherHost = await fetch(`${ORIGIN}/v1/assign`, { method: 'POST', headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, relayHostId: stranger.relayHostId }) })
  record('S2 a repeat keeps the epoch; another host id with this token is 403', againBody.assignmentEpoch === 1 && otherHost.status === 403, `${againBody.assignmentEpoch}/${otherHost.status}`)

  const main = control(host, relayToken, assignment.assignmentEpoch, { identity: soloRelayAuthContext(id).identity })
  const ack = await main.client.connect()
  main.attach(ack.generation)
  record('S3 shipped control client completes the host proof with the solo identity', ack.generation >= 1, `generation=${ack.generation}`)

  const invite = await main.client.createInvite('device-a')
  const invitePhone = await phoneOutcome(id, invite.inviteToken)
  const inviteConnId = main.events.opens.at(-1)?.connId ?? ''
  record('S4 invite phone admitted (relay-hello strict-parses)', RelayPhoneHelloSchema.safeParse(invitePhone.state.hello).success && invitePhone.state.hello?.credentialKind === 'invite', JSON.stringify(invitePhone.state.hello))
  const resumeToken = b64url(randomBytes(32))
  const installed = await main.client.installCredential({ reqId: 'install-1', relayDeviceId: 'device-a', newResumeTokenHash: sha(resumeToken), authorization: { mode: 'relay-basis', basisConnId: inviteConnId } })
  invitePhone.ws.close()
  const resumePhone = await phoneOutcome(id, resumeToken)
  record('S4 credential installed; resume phone admitted', installed.currentVersion >= 1 && resumePhone.state.hello?.credentialKind === 'resume', JSON.stringify(resumePhone.state.hello))
  resumePhone.ws.close()

  const resolve = (token: string) => fetch(`${ORIGIN}/v1/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, relayHostId: id, resumeToken: token }) })
  const resolved = await resolve(resumeToken)
  const resolvedBody = (await resolved.json()) as Record<string, unknown>
  const unknown = await resolve(b64url(randomBytes(32)))
  record('S5 /v1/resolve answers the phone with this cell; an unknown token is 401', resolved.status === 200 && resolvedBody.cellUrl === ORIGIN && resolvedBody.assignmentEpoch === 1 && typeof resolvedBody.leaseExpiresAt === 'number' && unknown.status === 401, `${resolved.status} ${JSON.stringify(resolvedBody)} / ${unknown.status}`)
  main.client.closeNow()
}

async function main(): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), 'relay-edge-solo-e2e-'))
  let dev: ChildProcess | null = null
  let devLog = ''
  try {
    await writeConfig([host.relayHostId])
    dev = spawn('npx', ['wrangler', 'dev', '--config', join(configDir, 'wrangler.jsonc'), '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', stateDir], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    dev.stdout?.on('data', (d) => (devLog += d))
    dev.stderr?.on('data', (d) => (devLog += d))
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${ORIGIN}/health`)).ok) { break }
      } catch {}
      if (i > 120) { throw new Error(`wrangler dev did not start:\n${devLog}`) }
      await sleep(500)
    }
    await flow()
  } catch (error) {
    console.error(error)
    console.error(devLog.split('\n').filter((l) => /error|exception/i.test(l)).slice(-20).join('\n'))
    process.exitCode = 1
  } finally {
    dev?.kill('SIGINT')
    await sleep(500)
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) { process.exitCode = 1 }
}

void main()
