import type { ServeReadiness } from '../server/serve-readiness'
import type { TopoRuntimeRpcServer } from '../runtime/rpc/server/runtime-rpc'
import { buildServePairingReadiness } from '../server/serve-pairing-readiness'
import type { TopodHealth } from './topod-health'
import type { TopodOptions } from './topod-start-contract'

export async function buildTopodServeReadiness(input: {
  options: TopodOptions
  runtimeId: string
  rpc: Pick<TopoRuntimeRpcServer, 'getWebSocketEndpoint' | 'createPairingOffer'>
  collectHealth: () => Promise<TopodHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    ...(await buildServePairingReadiness(input.options, input.rpc)),
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
