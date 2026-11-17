import { readFile, stat } from 'node:fs/promises'
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

function isMissing(error: unknown): boolean {
  return asRecord(error)?.code === 'ENOENT'
}

/** Null means unreadable, never empty: rewriting it would drop every other secret. */
async function readVault(): Promise<VaultFile | null> {
  const path = vaultPath()
  try {
    if ((await stat(path)).size > MAX_BYTES) {
      return null
    }
    const parsed = asRecord(JSON.parse(await readFile(path, 'utf8')))
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
    if (isMissing(error)) {
      return { version: 1, ciphertexts: {} }
    }
    if (isUnreadableError(error)) {
      return null
    }
  }
  return { version: 1, ciphertexts: {} }
}

let writes: Promise<unknown> = Promise.resolve()

/** Serializes read-modify-write so two secret saves never drop each other. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = writes.then(task, task)
  writes = next.catch(() => {})
  return next
}

function decrypt(cipher: string | undefined): string | null {
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

/** Reads the vault once per launch; the returned lookup decrypts `topoMcpSecretKey` entries. */
export async function loadTopoMcpSecretReader(): Promise<(key: string) => string | null> {
  const ciphertexts = (await readVault())?.ciphertexts ?? {}
  return (key) => decrypt(ciphertexts[key])
}

export async function hasTopoMcpSecret(key: string): Promise<boolean> {
  return typeof (await readVault())?.ciphertexts[key] === 'string'
}

// Never fall back to plaintext: a weak or missing keyring refuses the write instead.
export function writeTopoMcpSecret(key: string, value: string): Promise<TopoMcpSecretResult<true>> {
  return serialized(async () => {
    const store = hasSecretStore() ? getSecretStore() : null
    if (!store?.isEncryptionAvailable()) {
      return { ok: false, error: 'OS-backed encryption is unavailable; secret not stored' }
    }
    const gap = store.describeProtectionGap()
    if (gap) {
      return { ok: false, error: gap }
    }
    const vault = await readVault()
    if (!vault) {
      return { ok: false, error: UNREADABLE }
    }
    if (
      !Object.hasOwn(vault.ciphertexts, key) &&
      Object.keys(vault.ciphertexts).length >= MAX_KEYS
    ) {
      return { ok: false, error: `MCP secret vault exceeds the ${MAX_KEYS}-key limit` }
    }
    vault.ciphertexts[key] = store.encryptString(value).toString('base64')
    writeSecureFile(vaultPath(), JSON.stringify(vault, null, 2))
    return { ok: true, value: true }
  })
}

export function deleteTopoMcpSecret(key: string): Promise<void> {
  return serialized(async () => {
    const vault = await readVault()
    if (vault && Object.hasOwn(vault.ciphertexts, key)) {
      delete vault.ciphertexts[key]
      writeSecureFile(vaultPath(), JSON.stringify(vault, null, 2))
    }
  })
}
