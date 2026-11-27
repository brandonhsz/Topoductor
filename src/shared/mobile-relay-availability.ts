import type { TopoProfileAuthStatus } from './topo-profiles'

// A self-hosted relay authenticates by host key, so it is usable without signing in.
export type MobileRelayAuthStatus = TopoProfileAuthStatus & { relaySelfHosted?: true }

export function canUseMobileRelay(status: MobileRelayAuthStatus | null | undefined): boolean {
  return status?.state === 'connected' || status?.relaySelfHosted === true
}
