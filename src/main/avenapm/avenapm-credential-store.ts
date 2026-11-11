import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import type { AvenaPMUser } from '../../shared/avenapm/avenapm-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'

export type AvenaPMCredential = { baseUrl: string; token: string; user: AvenaPMUser }

const store = createEncryptedApiKeyFileStore({
  fileName: 'avenapm-credential.enc',
  envelopePrefix: 'topo-avenapm-credential:v1:',
  providerLabel: 'AvenaPM',
  logScope: 'avenapm'
})

export function saveAvenaPMCredential(credential: AvenaPMCredential): void {
  store.save(JSON.stringify(credential))
}

export function readAvenaPMCredential(): AvenaPMCredential | null {
  const raw = store.read()
  if (!raw) {
    return null
  }
  try {
    const parsed = asRecord(JSON.parse(raw))
    const user = asRecord(parsed?.user)
    if (
      typeof parsed?.baseUrl === 'string' &&
      typeof parsed.token === 'string' &&
      typeof user?.email === 'string'
    ) {
      return {
        baseUrl: parsed.baseUrl,
        token: parsed.token,
        user: { email: user.email, name: typeof user.name === 'string' ? user.name : user.email }
      }
    }
  } catch {
    // Corrupt credentials behave like a disconnected account.
  }
  return null
}

export const clearAvenaPMCredential = store.clear
