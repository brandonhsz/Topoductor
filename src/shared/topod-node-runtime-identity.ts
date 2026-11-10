import { NODE_RUNTIME_PIN } from './node-runtime-pin'
import type { TopodPreflightRuntimeIdentity } from './topod-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const TOPOD_NODE_RUNTIME_IDENTITY: TopodPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
