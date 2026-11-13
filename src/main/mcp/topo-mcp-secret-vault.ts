import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { getSecretStore, hasSecretStore } from '../../shared/secret-store'
import { isUnreadableError, writeSecureFile } from '../../shared/secure-storage/secure-file'

type VaultFile = { version: 1; ciphertexts: Record<string, string> }
export type TopoMcpSecretResult<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_BYTES = 1024 * 1024
const MAX_KEYS = 512
const UNREADABLE = 'MCP secret vault exists but could not be read; refusing to overwrite it'

function vaultPath(): string {
  return join(getAppEnvironment().getPath('userData'), 'mcp-secrets.json.enc')
}

/** Null means unreadable, never empty: rewriting it would drop every other secret. */
function readVault(): VaultFile | null {
  const path = vaultPath()
  try {
    if (!existsSync(path)) {
      return { version: 1, ciphertexts: {} }
    }
    if (statSync(path).size > MAX_BYTES) {
      return null
    }
    const parsed = asRecord(JSON.parse(readFileSync(path, 'utf8')))
    const ciphertexts = asRecord(parsed?.ciphertexts)
    if (parsed?.version === 1 && ciphertexts) {
      return {
        version: 1,
        ciphertexts: Object.fromEntries(
          Object.entries(ciphertexts).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      }
    }
  } catch (error) {
    if (isUnreadableError(error)) {
      return null
    }
  }
  return { version: 1, ciphertexts: {} }
}

/** Secret env and header values for Topo-managed MCP servers, keyed by `topoMcpSecretKey`. */
export function readTopoMcpSecret(key: string): string | null {
  const cipher = readVault()?.ciphertexts[key]
  if (typeof cipher !== 'string' || !hasSecretStore()) {
    return null
  }
  const store = getSecretStore()
  if (!store.isEncryptionAvailable()) {
    return null
  }
  try {
    return store.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

export function hasTopoMcpSecret(key: string): boolean {
  return typeof readVault()?.ciphertexts[key] === 'string'
}

// Never fall back to plaintext: a weak or missing keyring refuses the write instead.
export function writeTopoMcpSecret(key: string, value: string): TopoMcpSecretResult<true> {
  const store = hasSecretStore() ? getSecretStore() : null
  if (!store?.isEncryptionAvailable()) {
    return { ok: false, error: 'OS-backed encryption is unavailable; secret not stored' }
  }
  const gap = store.describeProtectionGap()
  if (gap) {
    return { ok: false, error: gap }
  }
  const vault = readVault()
  if (!vault) {
    return { ok: false, error: UNREADABLE }
  }
  if (!Object.hasOwn(vault.ciphertexts, key) && Object.keys(vault.ciphertexts).length >= MAX_KEYS) {
    return { ok: false, error: `MCP secret vault exceeds the ${MAX_KEYS}-key limit` }
  }
  vault.ciphertexts[key] = store.encryptString(value).toString('base64')
  writeSecureFile(vaultPath(), JSON.stringify(vault, null, 2))
  return { ok: true, value: true }
}

export function deleteTopoMcpSecret(key: string): void {
  const vault = readVault()
  if (vault && Object.hasOwn(vault.ciphertexts, key)) {
    delete vault.ciphertexts[key]
    writeSecureFile(vaultPath(), JSON.stringify(vault, null, 2))
  }
}
