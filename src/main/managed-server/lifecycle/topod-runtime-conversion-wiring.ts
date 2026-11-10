import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { TopodMigrationDestinationCatalog } from '../migration/cutover/topod-migration-cutover-coordinator'
import {
  abortRemoteTopodMigrationCatalog,
  commitRemoteTopodMigrationCatalog,
  readRemoteTopodMigrationCatalogState,
  stageRemoteTopodMigrationCatalog
} from '../migration/catalog/topod-migration-catalog-client'
import { listRemoteTopodRepositories } from '../migration/linking/topod-server-repositories'
import {
  stageRemoteTopodMigrationBlobChunk,
  stageRemoteTopodMigrationSnapshotChunk
} from '../migration/transfers/topod-migration-chunk-client'
import { readRemoteTopodMigrationCapabilities } from '../migration/catalog/topod-migration-capabilities-client'
import { abortRemoteTopodMigrationCatalogByReference } from '../migration/catalog/topod-migration-catalog-reference-client'
import {
  enableRemoteTopodAutomation,
  type EnableServerAutomation
} from '../../persistence/migrating-topod-catalog/topod-migration-moved-automations'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-leases'
import type { TopodManagedConversionArgs } from './topod-runtime-conversion'
import type { TopodServerRepository } from '../migration/linking/topod-server-repositories'
import {
  listRemoteTopodFolderCatalog,
  type TopodServerFolderCatalog
} from '../migration/linking/topod-server-folder-workspaces'

export function topodMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): TopodMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteTopodMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteTopodMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteTopodMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteTopodMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteTopodMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteTopodMigrationSnapshotChunk(pairingCode, request, options),
    readCapabilities: () => readRemoteTopodMigrationCapabilities(pairingCode, options),
    stageBlobChunk: (request) => stageRemoteTopodMigrationBlobChunk(pairingCode, request, options)
  }
}

export function topodServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<TopodServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteTopodRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function topodServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<TopodServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteTopodFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function topodServerAutomationEnablerFor(
  environment: KnownRuntimeEnvironment
): EnableServerAutomation {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return (automation) => enableRemoteTopodAutomation(pairingCode, automation, options)
}

export function conversionCollaborators(): Pick<
  TopodManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'serverAutomationEnablerFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: topodMigrationDestinationFor,
    serverRepositoriesFor: topodServerRepositoriesFor,
    serverFolderCatalogFor: topodServerFolderCatalogFor,
    serverAutomationEnablerFor: topodServerAutomationEnablerFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
