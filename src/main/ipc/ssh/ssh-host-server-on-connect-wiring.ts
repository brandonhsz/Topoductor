import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getManagedTopodFenceEnvironmentId,
  managedTopodServerName
} from '../../../shared/managed-topod-ssh-owner'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findTopodMigrationSourceCutoverForTarget } from '../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import { abandonTopodConversion } from '../../managed-server/migration/cutover/topod-conversion-abandon'
import { retainTopodMigrationSource } from '../../persistence/migrating-topod-catalog/topod-migration-source-retention'
import { enableMovedTopodAutomationsForTarget } from '../../persistence/migrating-topod-catalog/topod-migration-moved-automations'
import { hasTopodTemplate } from '../../topod/topod-artifact-materializer'
import { isTopodHostUnavailableFixableOnHost } from '../../topod/topod-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/host-server/managed-server-update-deps'
import { ensureTopodManagedTunnel } from '../../managed-server/lifecycle/topod-managed-tunnel'
import { verifyTopodManagedServing } from '../../managed-server/lifecycle/topod-managed-serving-verify'
import { convertSshTargetToManagedTopod } from '../../managed-server/lifecycle/topod-runtime-conversion'
import {
  topodMigrationDestinationFor,
  topodServerAutomationEnablerFor,
  topodServerFolderCatalogFor,
  topodServerRepositoriesFor
} from '../../managed-server/lifecycle/topod-runtime-conversion-wiring'
import { createManagedTopodEnvironment } from '../../managed-server/lifecycle/topod-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/host-server/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/endpoints/ssh-host-relay-terminals-on-connect'
import { requireManagedTopodInfrastructure } from '../../managed-server/lifecycle/topod-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/host-server/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/remote-host/ssh-host-platform-memo'
import { knownTopodTunnelTransport } from '../../managed-server/lifecycle/topod-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableTopodSetup } from '../../managed-server/migration/cutover/topod-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/bridge/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getTopodRuntimeClaims()
  const store = registry.getTopodMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = (environmentId: string): boolean =>
    listEnvironments(userDataPath).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: (target) => {
      const environmentId = getManagedTopodFenceEnvironmentId(target)
      return environmentId && isRegistered(environmentId) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureTopodManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyTopodManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findTopodMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase !== 'destination-committed') {
        return 0
      }
      await retainTopodMigrationSource(userDataPath, head.migrationId, store)
      // Retry what earlier connects could not reach the server to re-enable.
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === head.destinationEnvironmentId
      )
      return environment
        ? enableMovedTopodAutomationsForTarget(
            userDataPath,
            target.id,
            topodServerAutomationEnablerFor(environment)
          )
        : 0
    },
    hasTemplate: hasTopodTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isTopodHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedTopodFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.topodProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedTopodInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedTopodEnvironment(userDataPath, {
        name: target.topodProvisioning?.name ?? managedTopodServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedTopod(userDataPath, {
        sshTargetId: target.id,
        name: managedTopodServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: topodMigrationDestinationFor,
        serverRepositoriesFor: topodServerRepositoriesFor,
        serverFolderCatalogFor: topodServerFolderCatalogFor,
        serverAutomationEnablerFor: topodServerAutomationEnablerFor
      })
      // A quiet retry's refusal is not the user's attempt, so it keeps their consent.
      const quiet = connectInFlight.get(target.id)?.quiet?.active === true
      if (converted.outcome === 'converted' || (converted.outcome === 'refused' && !quiet)) {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedTopodFenceEnvironmentId(target) ??
        getManagedTopodFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !isRegistered(environmentId)) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findTopodMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonTopodConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: topodMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findTopodMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableTopodSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownTopodTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      const attempt = connectInFlight.get(target.id)
      if (!attempt || attempt.quiet?.active) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
