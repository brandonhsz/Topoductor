import { hostMallocTunablesLaunchEnv } from '../../memory/host-malloc-tunables'
import type { TopodHostTransport } from '../../managed-server/install/topod-host-transport'

/** An older slot would leak GLIBC_TUNABLES to user shells, so only this build's own slot gets it. */
export function withOwnBuildLaunchEnv<T extends TopodHostTransport>(
  conn: T,
  ownBuildVersion: () => string | null
): T {
  const topodLaunchEnv: TopodHostTransport['topodLaunchEnv'] = async (launch) => [
    ...((await conn.topodLaunchEnv?.(launch)) ?? []),
    ...(launch.fullVersion === ownBuildVersion() ? hostMallocTunablesLaunchEnv() : [])
  ]
  // Delegate rather than spread so prototype methods survive; #private fields would still need explicit forwarding.
  return Object.create(conn, { topodLaunchEnv: { value: topodLaunchEnv } })
}
