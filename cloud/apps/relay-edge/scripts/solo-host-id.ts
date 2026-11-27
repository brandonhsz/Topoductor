// Prints a desktop's relayHostId from its E2EE keypair file (reads the public key only).
// Usage: pnpm solo:host-id "<Topo userData>/<keypair file>"
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: pnpm solo:host-id <path to the desktop E2EE keypair JSON>')
  process.exit(1)
}
const { publicKeyB64 } = JSON.parse(readFileSync(path, 'utf8')) as { publicKeyB64?: string }
const publicKey = Buffer.from(publicKeyB64 ?? '', 'base64')
if (publicKey.byteLength !== 32) {
  console.error('not an E2EE keypair file')
  process.exit(1)
}
console.log(createHash('sha256').update(publicKey).digest('base64url').slice(0, 16))
