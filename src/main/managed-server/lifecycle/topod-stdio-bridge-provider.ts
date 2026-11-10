// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { TopodStdioBridgeUnavailableError } from '../../topod/topod-host-unavailable'
import type { TopodHostTransport } from '../install/topod-host-transport'
import {
  checkTopodStdioBridge,
  openTopodStdioBridgeChannel,
  resolveTopodStdioBridge,
  type TopodStdioBridge
} from './topod-stdio-bridge'
import { listenTopodStdioBridge } from './topod-stdio-bridge-listener'

import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type TopodStdioBridgeDependencies = {
  resolveBridge: (conn: TopodHostTransport, port: number) => Promise<TopodStdioBridge>
  checkBridge: (conn: TopodHostTransport, bridge: TopodStdioBridge) => Promise<unknown>
  openChannel: (conn: TopodHostTransport, bridge: TopodStdioBridge) => Promise<RemoteCommandChannel>
}

export const TOPOD_STDIO_BRIDGE_DEPENDENCIES: TopodStdioBridgeDependencies = {
  resolveBridge: resolveTopodStdioBridge,
  checkBridge: checkTopodStdioBridge,
  openChannel: openTopodStdioBridgeChannel
}

export class TopodStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: TopodStdioBridgeDependencies = TOPOD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startTopodStdioBridge(conn, options, this.dependencies)
  }
}

export async function startTopodStdioBridge(
  host: TopodHostTransport,
  options: PortForwardStartOptions,
  deps: TopodStdioBridgeDependencies
): Promise<StartedPortForward> {
  let bridge: Promise<TopodStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<TopodStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof TopodStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] Topo stdio bridge check was unverifiable:', error)
  }
  return listenTopodStdioBridge(options, async () => {
    const resolved = await resolveBridge()
    return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
  })
}
