// Generates the solo relay's secrets into gitignored files: .solo-secrets.json (wrangler secret bulk)
// and .dev.vars (wrangler dev). Usage: pnpm solo:keys --host <relayHostId> [--host <id> ...]
import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportJWK, generateKeyPair } from 'jose'

const HOST_ID = /^[A-Za-z0-9_-]{16}$/
const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const hosts = args.flatMap((arg, index) => (args[index - 1] === '--host' ? [arg] : []))
if (hosts.length === 0 || hosts.some((id) => !HOST_ID.test(id))) {
  console.error('usage: pnpm solo:keys --host <relayHostId> [--host <id> ...]  (see pnpm solo:host-id)')
  process.exit(1)
}
const secretsPath = join(root, '.solo-secrets.json')
if (existsSync(secretsPath) && !args.includes('--force')) {
  console.error('.solo-secrets.json exists; rotating keys signs out every desktop. Pass --force to replace it.')
  process.exit(1)
}

const kid = `solo-${randomBytes(6).toString('hex')}`
const pair = await generateKeyPair('ES256', { extractable: true })
const secrets = {
  RELAY_SIGNING_JWK: JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid, alg: 'ES256' }),
  RELAY_JWKS: JSON.stringify({ keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' }] }),
  SOLO_CHALLENGE_KEY: randomBytes(32).toString('base64url'),
  ADMIN_SIGNING_KEY: randomBytes(32).toString('base64url'),
  SOLO_ALLOWED_HOST_IDS: hosts.join(',')
}
writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
const devVars = Object.entries(secrets).map(([name, value]) => `${name}='${value}'`)
writeFileSync(join(root, '.dev.vars'), `${devVars.join('\n')}\n`, { mode: 0o600 })
console.log('Wrote .solo-secrets.json and .dev.vars (gitignored). Upload with:')
console.log('  pnpm exec wrangler secret bulk .solo-secrets.json --config wrangler.solo.jsonc')
