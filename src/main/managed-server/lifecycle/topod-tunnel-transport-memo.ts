export type TopodTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, TopodTunnelTransport>()

export function rememberTopodTunnelTransport(
  targetId: string,
  transport: TopodTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownTopodTunnelTransport(targetId: string): TopodTunnelTransport | null {
  return transports.get(targetId) ?? null
}
