import { parseExecutionHostId } from '../../shared/execution-host'
import {
  getRuntimeSshAccess,
  preferredEndpoint,
  type KnownRuntimeEnvironment
} from '../../shared/remote-runtime/host-catalog/runtime-environments'
import { classifyRemotePairingHostname } from '../../shared/remote-runtime/pairing/remote-pairing-address'
import type {
  RemoteDesktopError,
  RemoteDesktopHostId
} from '../../shared/remote-desktop/remote-desktop-contract'

export type RemoteDesktopRoute =
  | { kind: 'ssh'; targetId: string }
  | { kind: 'direct'; host: string }

export type RemoteDesktopRouteDependencies = {
  resolveRuntimeEnvironment: (environmentId: string) => KnownRuntimeEnvironment | null
}

export type RemoteDesktopRouteResult =
  | { ok: true; route: RemoteDesktopRoute }
  | { ok: false; error: RemoteDesktopError }

/** Pick how main reaches the host's VNC port: through its SSH session, else directly on a private network. */
export function resolveRemoteDesktopRoute(
  hostId: RemoteDesktopHostId,
  dependencies: RemoteDesktopRouteDependencies
): RemoteDesktopRouteResult {
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'ssh') {
    return { ok: true, route: { kind: 'ssh', targetId: parsed.targetId } }
  }
  if (parsed?.kind !== 'runtime') {
    return unsupported()
  }
  const environment = dependencies.resolveRuntimeEnvironment(parsed.environmentId)
  if (!environment) {
    return unsupported()
  }
  const sshAccess = getRuntimeSshAccess(environment)
  if (sshAccess) {
    return { ok: true, route: { kind: 'ssh', targetId: sshAccess.sshTargetId } }
  }
  let hostname: string
  try {
    hostname = new URL(preferredEndpoint(environment).endpoint).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return unsupported()
  }
  const kind = classifyRemotePairingHostname(hostname)
  // VNC frames are unencrypted; only networks that already encrypt or stay local may carry them directly.
  if (kind === 'tailscale' || kind === 'lan') {
    return { ok: true, route: { kind: 'direct', host: hostname } }
  }
  if (kind === 'loopback') {
    return unsupported()
  }
  return {
    ok: false,
    error: {
      code: 'host_not_private',
      message:
        'This server is reached over a public address. Remote desktop connects only over Tailscale, a local network, or SSH.'
    }
  }
}

function unsupported(): RemoteDesktopRouteResult {
  return {
    ok: false,
    error: {
      code: 'host_unsupported',
      message:
        'Remote desktop is available for SSH hosts and servers on Tailscale or a local network.'
    }
  }
}
