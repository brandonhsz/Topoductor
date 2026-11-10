import type { EphemeralVmRuntimeRecord } from '../../shared/ephemeral-vm-runtimes'
import { removeManagedTopodEnvironment } from '../../shared/remote-runtime/host-store/runtime-environment-managed-topod-store'
import {
  listEnvironments,
  removeEnvironment
} from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { getTopodSshDeployment } from '../../shared/remote-runtime/host-catalog/runtime-environments'

/** Remove destroyed VM servers so managed tunnels stop reconnecting. */
export async function releaseEphemeralVmRuntimeEnvironments(
  userDataPath: string,
  runtime: Pick<EphemeralVmRuntimeRecord, 'runtimeEnvironmentId' | 'sshTargetId'>,
  // Same retirement as a Settings removal, so the host's session partition and transport go too.
  retireRemovedEnvironment: (environmentId: string) => void
): Promise<void> {
  // Relay-era conversions may have recorded only the SSH target, not the server ID.
  const environments = listEnvironments(userDataPath).filter(
    (entry) =>
      entry.id === runtime.runtimeEnvironmentId ||
      (runtime.sshTargetId !== undefined &&
        getTopodSshDeployment(entry)?.sshTargetId === runtime.sshTargetId)
  )
  for (const environment of environments) {
    if (!environment.topodDeployment) {
      removeEnvironment(userDataPath, environment.id)
      retireRemovedEnvironment(environment.id)
      continue
    }
    const { closeTopodManagedTunnel } =
      await import('../managed-server/lifecycle/topod-managed-tunnel')
    await closeTopodManagedTunnel(environment.id).catch(() => undefined)
    removeManagedTopodEnvironment(userDataPath, environment.id)
    retireRemovedEnvironment(environment.id)
  }
}
