import path from 'node:path'
import { installTopodHostAdapters } from '../../../src/main/topod/topod-host-adapters'
import type { Store } from '../../../src/main/persistence/loading-store/store'
import { createProfileStateStore } from '../../../src/main/persistence/profile-state/profile-state-store-factory'

export function createDaemonGenerationProfileStore(directory: string): Store {
  installTopodHostAdapters()
  // The bundled fixture has no profile writer worker; use the synchronous SQLite authority.
  return createProfileStateStore({
    dataFile: path.join(directory, 'topo-data.json'),
    databaseFile: path.join(directory, 'profile-state.sqlite'),
    profileId: 'legacy-close-fixture'
  }).store
}
