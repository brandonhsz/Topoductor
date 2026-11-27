// Single-owner relay entry (wrangler.solo.example.jsonc): the edge Worker plus its own director and
// host-key token issuer, so one Cloudflare Worker is the whole relay.
import edge from '../index'
import { handleSoloRoute } from './solo-director'
import type { SoloEnv } from './solo-env'

export { SpliceRelay } from '../splice-relay'
export { SoloHostRelay as HostRelay } from './solo-host-relay'

export default {
  async fetch(request: Request, env: SoloEnv): Promise<Response> {
    return (await handleSoloRoute(request, env)) ?? edge.fetch(request, env)
  }
} satisfies ExportedHandler<SoloEnv>
