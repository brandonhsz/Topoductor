import { z } from 'zod'

// Why: a WSL host's server is one per Linux login, so other Topo desktops may share it.
export const TOPOD_PEER_DESKTOPS_METHOD = 'host.peerDesktops'
// A desktop names its installation on its long-lived control socket, so peers tell installations apart.
export const TOPOD_DECLARE_CLIENT_METHOD = 'host.declareClient'

const ClientInstanceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)

export const TopodDeclareClientParamsSchema = z
  .object({ clientInstanceId: ClientInstanceIdSchema })
  .strict()

/** The caller's own installation, so none of its sockets count as another desktop. */
export const TopodPeerDesktopsParamsSchema = z
  .object({ clientInstanceId: ClientInstanceIdSchema.optional() })
  .strict()

/** Other desktop installations with a declared control socket open on this server right now. */
export const TopodPeerDesktopsResultSchema = z.object({
  peers: z.array(z.object({ name: z.string() }))
})

export type TopodPeerDesktopsResult = z.infer<typeof TopodPeerDesktopsResultSchema>
