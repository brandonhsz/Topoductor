/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../../../shared/remote-runtime/host-store/runtime-environment-store'
import { removeManagedTopodEnvironment } from '../../../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import { findTopodMigrationSourceCutoverForTarget } from '../../../persistence/migrating-topod-catalog/topod-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from '../../../ssh/migration-source/topod-migration-source-fence'
import { closeTopodManagedTunnel } from '../../lifecycle/topod-managed-tunnel'
import type { SshTargetTopodClaims } from '../../../ssh/targets/ssh-target-topod-claims'
import { withTopodActivationLock } from '../../activation/topod-activation-lock'
import { withDeactivatedVersionCommitted } from '../../activation/topod-activation-record'
import {
  readTopodActivationRecord,
  writeTopodActivationRecord
} from '../../activation/topod-activation-record-store'
import { managedTopodSlot } from '../../lifecycle/topod-managed-runtime-context'
import { resolveTopodRemoteContext } from '../../install/topod-remote-context'
import { topodStopFreedTheHost } from '../../install/topod-remote-process-control'
import { topodSlotDir, stopTopodSlot } from '../../activation/topod-recovery-slot'

import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../../ssh/targets/ssh-target-registry'
import { errorMessage } from '../../../../shared/error-message'

export async function releaseUnreachableTopodSetup(args: {
  userDataPath: string
  claims: SshTargetTopodClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findTopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeTopodManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedTopod(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[topod] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (isRegistered(environmentId)) {
    removeManagedTopodEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedTopod(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveTopodRemoteContext(
    target,
    await connectionManager.connect(target),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedTopodSlot(context, 0, signal)
  await withTopodActivationLock(
    slot,
    async () => {
      const record = await readTopodActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopTopodSlot(slot, topodSlotDir(slot, record.active), false)
      if (topodStopFreedTheHost(stopped)) {
        await writeTopodActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
