import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/remote-runtime/host-catalog/runtime-environment-reconciliation-record'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { rebuildTopodManagedTunnel } from './topod-managed-tunnel'
import { requireManagedTopodEnvironment } from './topod-managed-runtime-context'

export type LifecycleArgs = { selector: string; signal?: AbortSignal }

export function withManagedTopodLifecycle<T>(
  userDataPath: string,
  selector: string,
  run: (managed: ReturnType<typeof requireManagedTopodEnvironment>) => Promise<T>
): Promise<T> {
  const { environment, deployment } = requireManagedTopodEnvironment(userDataPath, selector)
  return runTargetLifecycle(deployment.sshTargetId, async () => {
    // Re-read in the lifecycle queue because reconciliation/stop may have won first.
    const current = requireManagedTopodEnvironment(userDataPath, environment.id)
    assertRuntimeEnvironmentNotReconciling(current.environment)
    return run(current)
  })
}

/** Rebuild forwarding when a launched slot binds a different port. */
export async function followLaunchedServerPort(
  userDataPath: string,
  environmentId: string
): Promise<void> {
  try {
    await rebuildTopodManagedTunnel(userDataPath, environmentId)
  } catch (error) {
    // Server already launched; if tunnel rebuild fails, the next connect can forward its bound port.
    console.warn('[ssh] Could not forward to the relaunched managed Topo server:', error)
  }
}
