import type { ServeReadiness } from '../server/serve-readiness'
import type { TopodManagedStopContext } from '../../shared/topod-stop-request'

export type TopodOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Accept clients from public addresses, not only localhost, LAN and Tailscale. */
  allowPublic?: boolean
  /** Refuse public addresses even when grandfathered or otherwise accepted. */
  refusePublic?: boolean
  /** Slots have no browser client; topo serve supplies the installed app client. */
  webClientRoot?: string
}

export type TopodHandle = {
  readiness: ServeReadiness
  managedStop: TopodManagedStopContext
  stop(): Promise<void>
}
