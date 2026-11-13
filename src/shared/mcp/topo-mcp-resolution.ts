import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { TopoMcpServer, TopoMcpValue } from './topo-mcp-server-types'

export type TopoMcpValueSection = 'env' | 'headers'

/** Vault key for one secret value; server ids are unique across global and repo lists. */
export function topoMcpSecretKey(
  serverId: string,
  section: TopoMcpValueSection,
  key: string
): string {
  return `${serverId}:${section}:${key}`
}

/** Servers an agent receives: repo entries replace same-named global ones, then disabled and other-agent entries drop. */
export function resolveTopoMcpServers(args: {
  global: readonly TopoMcpServer[] | undefined
  repo: readonly TopoMcpServer[] | undefined
  agent: TuiAgent
}): TopoMcpServer[] {
  const byName = new Map<string, TopoMcpServer>()
  for (const server of [...(args.global ?? []), ...(args.repo ?? [])]) {
    byName.set(server.name, server)
  }
  return [...byName.values()].filter(
    (server) => server.enabled && (!server.agents?.length || server.agents.includes(args.agent))
  )
}

/** A value as each provider needs it: either literal text or the env var that carries the secret. */
export type ResolvedTopoMcpValue = { kind: 'plain'; value: string } | { kind: 'env'; name: string }

export type ResolvedTopoMcpServer = Omit<TopoMcpServer, 'env' | 'headers'> & {
  env?: Record<string, ResolvedTopoMcpValue>
  headers?: Record<string, ResolvedTopoMcpValue>
}

export type TopoMcpLaunch = {
  servers: ResolvedTopoMcpServer[]
  /** Secret values keyed by the env var names the servers reference; never put on a command line. */
  env: Record<string, string>
}

function secretEnvName(index: number, section: TopoMcpValueSection, key: string): string {
  return `TOPO_MCP_${index}_${section === 'env' ? 'E' : 'H'}_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
}

/** Moves each secret into the launch env; a secret missing from the vault drops that one entry. */
export function buildTopoMcpLaunch(
  servers: readonly TopoMcpServer[],
  readSecret: (key: string) => string | null
): TopoMcpLaunch {
  const env: Record<string, string> = {}
  const resolve = (
    server: TopoMcpServer,
    index: number,
    section: TopoMcpValueSection,
    values: Record<string, TopoMcpValue> | undefined
  ): Record<string, ResolvedTopoMcpValue> | undefined => {
    if (!values) {
      return undefined
    }
    const out: Record<string, ResolvedTopoMcpValue> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value.kind === 'plain') {
        out[key] = value
        continue
      }
      const secret = readSecret(topoMcpSecretKey(server.id, section, key))
      if (secret === null) {
        continue
      }
      const name = secretEnvName(index, section, key)
      env[name] = secret
      out[key] = { kind: 'env', name }
    }
    return Object.keys(out).length ? out : undefined
  }
  const resolved = servers.map((server, index): ResolvedTopoMcpServer => {
    const { env: serverEnv, headers, ...rest } = server
    const nextEnv = resolve(server, index, 'env', serverEnv)
    const nextHeaders = resolve(server, index, 'headers', headers)
    return {
      ...rest,
      ...(nextEnv ? { env: nextEnv } : {}),
      ...(nextHeaders ? { headers: nextHeaders } : {})
    }
  })
  return { servers: resolved, env }
}
