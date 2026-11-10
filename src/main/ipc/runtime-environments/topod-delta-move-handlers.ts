/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  TopodDeltaMovePreview,
  TopodDeltaMoveResult
} from '../../../shared/topod-managed-runtime'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { requireManagedTopodInfrastructure } from '../../managed-server/lifecycle/topod-managed-runtime-context'
import { ensureTopodManagedTunnel } from '../../managed-server/lifecycle/topod-managed-tunnel'
import {
  keepTopodServerVersion,
  runTopodDeltaMove
} from '../../managed-server/migration/cutover/topod-migration-delta-move'
import { planTopodDeltaMove } from '../../managed-server/migration/cutover/topod-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/endpoints/ssh-host-relay-census-for-target'
import {
  topodMigrationDestinationFor,
  topodServerAutomationEnablerFor
} from '../../managed-server/lifecycle/topod-runtime-conversion-wiring'
import { enableMovedTopodAutomationsForTarget } from '../../persistence/migrating-topod-catalog/topod-migration-moved-automations'
import { requiredString } from './topod-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../ssh/ssh-target-lifecycle-queue'

export function registerTopodDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewTopodDeltaMove',
    (_event, args: { sshTargetId: string }): TopodDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planTopodDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveTopodDelta',
    async (_event, args: { sshTargetId: string }): Promise<TopodDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === target.topodFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s Topo server is no longer registered.')
      }
      const result = await runTopodDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          topodMigrationDestinationFor(
            await ensureTopodManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        // Tunnel repair may have re-paired the server; read its current credentials.
        const paired = listEnvironments(userDataPath).find((entry) => entry.id === environment.id)
        const automationsLeftDisabled = await enableMovedTopodAutomationsForTarget(
          userDataPath,
          target.id,
          topodServerAutomationEnablerFor(paired ?? environment)
        ).catch((error: unknown) => {
          console.warn('[ssh] Could not re-enable moved automations:', error)
          return 0
        })
        publishResolvedChangedHostStatus(target, environment.id, automationsLeftDisabled)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepTopodServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepTopodServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedTopodInfrastructure()
  const store = targetStore.getTopodMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.topodFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older Topo to resolve.')
  }
  return { store, claims, target, environmentId: target.topodFence.environmentId }
}
