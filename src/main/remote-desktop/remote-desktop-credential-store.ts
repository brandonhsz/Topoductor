import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SecretStore } from '../../shared/secret-store'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'
import type {
  RemoteDesktopCredentialInput,
  RemoteDesktopCredentialStatus,
  RemoteDesktopHostId
} from '../../shared/remote-desktop/remote-desktop-contract'

const STORE_VERSION = 1
const MAX_FIELD_LENGTH = 1024

type SealedCredential = { username: string | null; sealedPassword: string }
type CredentialFile = { version: typeof STORE_VERSION; hosts: Record<string, SealedCredential> }

export class RemoteDesktopSecretStoreUnavailableError extends Error {
  constructor() {
    super('The OS keychain is unavailable, so Topo will not store this password.')
    this.name = 'RemoteDesktopSecretStoreUnavailableError'
  }
}

export function getRemoteDesktopCredentialPath(): string {
  return join(homedir(), '.topo', 'remote-desktop-credentials.json')
}

export class RemoteDesktopCredentialStore {
  constructor(
    private readonly secrets: () => SecretStore,
    private readonly path: string = getRemoteDesktopCredentialPath()
  ) {}

  async status(hostId: RemoteDesktopHostId): Promise<RemoteDesktopCredentialStatus> {
    const entry = (await this.read()).hosts[hostId]
    return entry ? { kind: 'saved', username: entry.username } : { kind: 'none' }
  }

  async save(
    hostId: RemoteDesktopHostId,
    input: RemoteDesktopCredentialInput
  ): Promise<RemoteDesktopCredentialStatus> {
    const password = input.password
    const username = input.username?.trim() || null
    if (
      !password ||
      password.length > MAX_FIELD_LENGTH ||
      (username?.length ?? 0) > MAX_FIELD_LENGTH
    ) {
      throw new Error('Remote desktop credential is invalid')
    }
    const secrets = this.secrets()
    // A VNC password grants control of the machine; never fall back to plaintext.
    if (!secrets.isEncryptionAvailable()) {
      throw new RemoteDesktopSecretStoreUnavailableError()
    }
    const file = await this.read()
    file.hosts[hostId] = {
      username,
      sealedPassword: secrets.encryptString(password).toString('base64')
    }
    writeSecureJsonFile(this.path, file)
    return { kind: 'saved', username }
  }

  async load(hostId: RemoteDesktopHostId): Promise<RemoteDesktopCredentialInput | null> {
    const entry = (await this.read()).hosts[hostId]
    if (!entry) {
      return null
    }
    const secrets = this.secrets()
    if (!secrets.isEncryptionAvailable()) {
      throw new RemoteDesktopSecretStoreUnavailableError()
    }
    let password: string
    try {
      password = secrets.decryptString(Buffer.from(entry.sealedPassword, 'base64'))
    } catch {
      // Sealed under another keychain key (e.g. a different Topo build); ask the user again.
      return null
    }
    return { username: entry.username, password }
  }

  async forget(hostId: RemoteDesktopHostId): Promise<void> {
    const file = await this.read()
    if (!(hostId in file.hosts)) {
      return
    }
    delete file.hosts[hostId]
    writeSecureJsonFile(this.path, file)
  }

  private async read(): Promise<CredentialFile> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return { version: STORE_VERSION, hosts: {} }
    }
    try {
      return parseCredentialFile(JSON.parse(text))
    } catch {
      return { version: STORE_VERSION, hosts: {} }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCredentialFile(raw: unknown): CredentialFile {
  const hosts: Record<string, SealedCredential> = {}
  if (!isRecord(raw) || raw.version !== STORE_VERSION || !isRecord(raw.hosts)) {
    return { version: STORE_VERSION, hosts }
  }
  for (const [hostId, entry] of Object.entries(raw.hosts)) {
    if (!isRecord(entry) || typeof entry.sealedPassword !== 'string') {
      continue
    }
    const username = entry.username
    if (username === null || typeof username === 'string') {
      hosts[hostId] = { username, sealedPassword: entry.sealedPassword }
    }
  }
  return { version: STORE_VERSION, hosts }
}
