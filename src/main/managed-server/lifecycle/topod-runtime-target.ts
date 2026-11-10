import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { resolveTopodDeploymentTargetFacts } from '../install/topod-deployment-target'
import { TopodHostUnsupportedError } from '../../topod/topod-host-unavailable'
import type { TopodHostTransport } from '../install/topod-host-transport'
import { pinnedRuntimeTargetForHost } from '../install/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

/** Lets a caller that knows the host kind add its own fix; the message is the one SSH shows. */
export class TopodHostGlibcUnsupportedError extends TopodHostUnsupportedError {
  constructor(target: string, glibc: string) {
    super(`No Topo runtime supports ${target} with glibc ${glibc}.`)
  }
}

export async function resolveTopodRuntimeTarget(options: {
  conn: TopodHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveTopodDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new TopodHostGlibcUnsupportedError(facts.target, glibc)
  }
  return target
}
