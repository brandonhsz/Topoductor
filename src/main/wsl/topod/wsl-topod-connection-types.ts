import type { WslHostDeferredUpdate } from '../../../shared/wsl-host-types'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { TopodTunnelIdentity } from '../../managed-server/lifecycle/topod-managed-tunnel-identity'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { TopodHostTransport } from '../../managed-server/install/topod-host-transport'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import type { WslTopodConnectionStatus } from './wsl-topod-connection-status'
import type { WslTopodDeployOptions, WslTopodLaunch } from './wsl-topod-launch-contract'
import type { WslTopodHostTarget } from './wsl-topod-host-target'
import type { WslTopodPairingRecovery } from './wsl-topod-pairing-identity'
import type { WslTopodStdioBridgeOptions } from './wsl-topod-stdio-bridge'

/** One open bridge to a distro's topod, as the connection manager publishes it. */
export type WslTopodConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** topod's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** topod's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** topod's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslHostDeferredUpdate | null
  close(): Promise<void>
}

export type WslTopodConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null
  /** The bridge port the host's record saved: rebinding it keeps the pairing across app restarts. */
  recordedLocalPort?: (environmentId: string) => number | null
  deployAndLaunch?: (distro: string, options: WslTopodDeployOptions) => Promise<WslTopodLaunch>
  createTransport?: (target: WslTopodHostTarget) => TopodHostTransport
  listen?: (
    transport: TopodHostTransport,
    options: WslTopodStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (pairingOffer: string, readiness: ServeReadiness) => Promise<TopodTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslTopodPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslTopodConnection | null,
    status: WslTopodConnectionStatus
  ) => void
}
