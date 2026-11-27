import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import {
  RemoteDesktopCredentialStore,
  RemoteDesktopSecretStoreUnavailableError
} from './remote-desktop-credential-store'

function reversingSecretStore(available = true): SecretStore {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from([...text].toReversed().join(''), 'utf8'),
    decryptString: (cipher) => [...cipher.toString('utf8')].toReversed().join(''),
    describeProtectionGap: () => null
  }
}

describe('RemoteDesktopCredentialStore', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remote-desktop-credentials-'))
    path = join(dir, 'credentials.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns a saved credential sealed on disk', async () => {
    const store = new RemoteDesktopCredentialStore(() => reversingSecretStore(), path)
    await store.save('runtime:env-1', { username: ' admin ', password: 'hunter2-secret' })

    expect(readFileSync(path, 'utf8')).not.toContain('hunter2-secret')
    expect(await store.status('runtime:env-1')).toEqual({ kind: 'saved', username: 'admin' })
    expect(await store.load('runtime:env-1')).toEqual({
      username: 'admin',
      password: 'hunter2-secret'
    })
    expect(await store.load('ssh:other')).toBeNull()
  })

  it('treats a password sealed under another keychain key as missing', async () => {
    await new RemoteDesktopCredentialStore(() => reversingSecretStore(), path).save('ssh:box', {
      username: null,
      password: 'pw'
    })
    const foreignKey: SecretStore = {
      ...reversingSecretStore(),
      decryptString: () => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage')
      }
    }
    const store = new RemoteDesktopCredentialStore(() => foreignKey, path)

    expect(await store.load('ssh:box')).toBeNull()
  })

  it('refuses to store a password without OS encryption', async () => {
    const store = new RemoteDesktopCredentialStore(() => reversingSecretStore(false), path)
    await expect(store.save('ssh:box', { username: null, password: 'pw' })).rejects.toThrow(
      RemoteDesktopSecretStoreUnavailableError
    )
    expect(await store.status('ssh:box')).toEqual({ kind: 'none' })
  })

  it('forgets one host and keeps the others', async () => {
    const store = new RemoteDesktopCredentialStore(() => reversingSecretStore(), path)
    await store.save('ssh:a', { username: null, password: 'one' })
    await store.save('ssh:b', { username: null, password: 'two' })
    await store.forget('ssh:a')

    expect(await store.status('ssh:a')).toEqual({ kind: 'none' })
    expect(await store.load('ssh:b')).toEqual({ username: null, password: 'two' })
  })
})
