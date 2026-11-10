import { join } from 'node:path'
import { prepareTopodSecretStore } from './topod-host-adapters'

export async function prepareTopodSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../shared/secret-store')
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  const { migratePlaintextCredentials, topodCredentialRoot } =
    await import('./topod-plaintext-credential-migration')
  // Keep sealing keys outside disposable TOPO_USER_DATA roots.
  if (await prepareTopodSecretStore(topodCredentialRoot(), userDataPath)) {
    migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'topo-data.json') })
}
