// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../shared/secret-store'
import { sweepStaleRecordStaging } from './topod-secret-key-record'
import {
  topodSecretStatePath,
  resolveState,
  type TopodSecretStorePrepareOptions,
  type StoreState
} from './topod-secret-key-resolution'
import { openTopodSecret, sealTopodSecret } from './topod-secret-sealing'

export type TopodSecretStore = SecretStore & {
  prepare(options: TopodSecretStorePrepareOptions): Promise<boolean>
}

export function createTopodSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): TopodSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'topod_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealTopodSecret(readyKey(), plainText),
    decryptString: (cipher) => openTopodSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "Topo's headless server has not loaded its credential key yet."
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(topodSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
