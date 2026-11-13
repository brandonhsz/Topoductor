import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import type { TopoMcpServer, TopoMcpValue } from '../../../../../shared/mcp/topo-mcp-server-types'
import {
  isTopoMcpEntryKey,
  isTopoMcpServerName,
  normalizeTopoMcpServer
} from '../../../../../shared/mcp/topo-mcp-server-types'
import {
  topoMcpSecretKey,
  type TopoMcpValueSection
} from '../../../../../shared/mcp/topo-mcp-resolution'

export type McpValueDraft = {
  rowId: string
  key: string
  secret: boolean
  /** For a secret, empty keeps the stored value. */
  value: string
}

export type McpServerDraft = {
  id: string
  name: string
  enabled: boolean
  transport: TopoMcpServer['transport']
  command: string
  /** One argument per line, so arguments with spaces need no quoting. */
  args: string
  url: string
  values: McpValueDraft[]
}

let rowSeq = 0
export function newMcpValueRow(): McpValueDraft {
  return { rowId: `row-${++rowSeq}`, key: '', secret: false, value: '' }
}

export function valueSection(transport: TopoMcpServer['transport']): TopoMcpValueSection {
  return transport === 'stdio' ? 'env' : 'headers'
}

export function draftFromServer(server: TopoMcpServer | null): McpServerDraft {
  const values = server ? (server.transport === 'stdio' ? server.env : server.headers) : undefined
  return {
    id: server?.id ?? createNonSecureContextUuid(),
    name: server?.name ?? '',
    enabled: server?.enabled ?? true,
    transport: server?.transport ?? 'stdio',
    command: server?.command ?? '',
    args: server?.args?.join('\n') ?? '',
    url: server?.url ?? '',
    values: Object.entries(values ?? {}).map(([key, value]) => ({
      ...newMcpValueRow(),
      key,
      secret: value.kind === 'secret',
      value: value.kind === 'plain' ? value.value : ''
    }))
  }
}

export type McpDraftError = 'name' | 'duplicate-name' | 'command' | 'url' | 'key'

export function validateMcpDraft(
  draft: McpServerDraft,
  takenNames: ReadonlySet<string>
): McpDraftError | null {
  if (!isTopoMcpServerName(draft.name.trim())) {
    return 'name'
  }
  if (takenNames.has(draft.name.trim())) {
    return 'duplicate-name'
  }
  if (draft.transport === 'stdio' && !draft.command.trim()) {
    return 'command'
  }
  if (draft.transport === 'http' && !/^https?:\/\/\S+$/i.test(draft.url.trim())) {
    return 'url'
  }
  const keys = draft.values.filter((row) => row.key.trim()).map((row) => row.key.trim())
  if (keys.some((key) => !isTopoMcpEntryKey(key)) || new Set(keys).size !== keys.length) {
    return 'key'
  }
  return null
}

/** The server to persist plus the secret writes and deletions that keep the vault in step with it. */
export function serverFromDraft(
  draft: McpServerDraft,
  previous: TopoMcpServer | null
): {
  server: TopoMcpServer
  secretWrites: { key: string; value: string }[]
  secretDeletes: string[]
} {
  const section = valueSection(draft.transport)
  const values: Record<string, TopoMcpValue> = {}
  const secretWrites: { key: string; value: string }[] = []
  for (const row of draft.values) {
    const key = row.key.trim()
    if (!key) {
      continue
    }
    if (row.secret) {
      values[key] = { kind: 'secret' }
      if (row.value) {
        secretWrites.push({ key: topoMcpSecretKey(draft.id, section, key), value: row.value })
      }
    } else {
      values[key] = { kind: 'plain', value: row.value }
    }
  }
  const server = normalizeTopoMcpServer({
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    transport: draft.transport,
    ...(draft.transport === 'stdio'
      ? {
          command: draft.command.trim(),
          args: draft.args.split('\n').filter((arg) => arg.trim()),
          env: values
        }
      : { url: draft.url.trim(), headers: values }),
    agents: previous?.agents
  })
  if (!server) {
    throw new Error('invalid MCP server draft')
  }
  const kept = new Set(
    Object.entries(values)
      .filter(([, value]) => value.kind === 'secret')
      .map(([key]) => topoMcpSecretKey(draft.id, section, key))
  )
  return {
    server,
    secretWrites,
    secretDeletes: mcpServerSecretKeys(previous).filter((key) => !kept.has(key))
  }
}

export function mcpServerSecretKeys(server: TopoMcpServer | null): string[] {
  if (!server) {
    return []
  }
  const section = valueSection(server.transport)
  const values = server.transport === 'stdio' ? server.env : server.headers
  return Object.entries(values ?? {})
    .filter(([, value]) => value.kind === 'secret')
    .map(([key]) => topoMcpSecretKey(server.id, section, key))
}
