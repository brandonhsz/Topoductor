import { asRecord } from '../workspace-setup/setup-script-import-parsers'
import type { ResolvedTopoMcpServer, ResolvedTopoMcpValue } from './topo-mcp-resolution'

// Cursor resolves ${env:NAME} in command, args, env, url and headers, so secrets stay out of the file.
function cursorValues(
  values: Record<string, ResolvedTopoMcpValue> | undefined
): Record<string, string> | undefined {
  if (!values) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.kind === 'plain' ? value.value : `\${env:${value.name}}`
    ])
  )
}

function cursorEntry(server: ResolvedTopoMcpServer): Record<string, unknown> | null {
  if (server.transport === 'stdio' && server.command) {
    const env = cursorValues(server.env)
    return {
      command: server.command,
      ...(server.args?.length ? { args: server.args } : {}),
      ...(env ? { env } : {})
    }
  }
  if (server.transport === 'http' && server.url) {
    const headers = cursorValues(server.headers)
    return { url: server.url, ...(headers ? { headers } : {}) }
  }
  return null
}

export type CursorMcpMerge =
  /** Null content means the file only ever held Topo's servers and can be removed. */
  { kind: 'write'; content: string | null; managedNames: string[] } | { kind: 'unchanged' }

/**
 * Lays Topo's servers over the user's `.cursor/mcp.json`. Entries Topo wrote last time are removed
 * first, so a server deleted in Topo disappears; the user's own entries are kept unless a Topo
 * server takes the same name. A file Topo cannot parse is never rewritten.
 */
export function mergeCursorTopoMcpConfig(args: {
  existing: string | null
  previouslyManaged: readonly string[]
  createdByTopo: boolean
  servers: readonly ResolvedTopoMcpServer[]
}): CursorMcpMerge {
  let root: Record<string, unknown> = {}
  if (args.existing !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(args.existing)
    } catch {
      return { kind: 'unchanged' }
    }
    const record = asRecord(parsed)
    if (!record) {
      return { kind: 'unchanged' }
    }
    root = record
  }
  if (root.mcpServers !== undefined && !asRecord(root.mcpServers)) {
    return { kind: 'unchanged' }
  }
  const mcpServers: Record<string, unknown> = { ...asRecord(root.mcpServers) }
  for (const name of args.previouslyManaged) {
    delete mcpServers[name]
  }
  const managedNames: string[] = []
  for (const server of args.servers) {
    const entry = cursorEntry(server)
    if (entry) {
      mcpServers[server.name] = entry
      managedNames.push(server.name)
    }
  }
  if (!managedNames.length && !args.previouslyManaged.length) {
    return { kind: 'unchanged' }
  }
  const onlyTopo =
    args.createdByTopo && !managedNames.length && Object.keys(mcpServers).length === 0
  const next = { ...root, mcpServers }
  return {
    kind: 'write',
    content: onlyTopo ? null : `${JSON.stringify(next, null, 2)}\n`,
    managedNames
  }
}
