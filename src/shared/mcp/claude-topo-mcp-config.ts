import type { ResolvedTopoMcpServer, ResolvedTopoMcpValue } from './topo-mcp-resolution'

type ClaudeMcpServerEntry =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }

// Claude expands ${VAR} in .mcp.json, so secrets stay in the process env, never in the file.
function claudeValues(
  values: Record<string, ResolvedTopoMcpValue> | undefined
): Record<string, string> | undefined {
  if (!values) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.kind === 'plain' ? value.value : `\${${value.name}}`
    ])
  )
}

/** Claude Code's `.mcp.json` shape for Topo's resolved servers. */
export function claudeTopoMcpConfig(servers: readonly ResolvedTopoMcpServer[]): {
  mcpServers: Record<string, ClaudeMcpServerEntry>
} {
  const mcpServers: Record<string, ClaudeMcpServerEntry> = {}
  for (const server of servers) {
    if (server.transport === 'stdio' && server.command) {
      const env = claudeValues(server.env)
      mcpServers[server.name] = {
        command: server.command,
        ...(server.args?.length ? { args: server.args } : {}),
        ...(env ? { env } : {})
      }
    } else if (server.transport === 'http' && server.url) {
      const headers = claudeValues(server.headers)
      mcpServers[server.name] = { type: 'http', url: server.url, ...(headers ? { headers } : {}) }
    }
  }
  return { mcpServers }
}
