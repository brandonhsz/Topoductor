import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { TopodManagedServing } from './topod-managed-serving'
import { verifyManagedTunnelServing } from './topod-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyTopodManagedServing(
  userDataPath: string,
  selector: string
): Promise<TopodManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
