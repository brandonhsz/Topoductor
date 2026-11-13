import { asRecord } from '../workspace-setup/setup-script-import-parsers'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import { isTuiAgent } from '../agent-launch/catalog/tui-agent-config'

/** A plain value is stored as typed; a secret value lives only in the main-process vault. */
export type TopoMcpValue = { kind: 'plain'; value: string } | { kind: 'secret' }

export type TopoMcpTransport = 'stdio' | 'http'

/** An MCP server Topo hands to the agents it launches, independent of any provider's config format. */
export type TopoMcpServer = {
  id: string
  name: string
  enabled: boolean
  transport: TopoMcpTransport
  command?: string
  args?: string[]
  url?: string
  /** stdio: child environment. */
  env?: Record<string, TopoMcpValue>
  /** http: request headers. */
  headers?: Record<string, TopoMcpValue>
  /** Absent or empty means every agent that supports Topo MCP injection. */
  agents?: TuiAgent[]
}

export type TopoMcpServerGlobalSettings = {
  /** MCP servers injected into every launch; a repo's own list overrides same-named entries. */
  topoMcpServers?: TopoMcpServer[]
}

export const TOPO_MCP_MAX_SERVERS = 64
const MAX_FIELD_LENGTH = 4096
const MAX_ARGS = 128
const MAX_ENTRIES = 64
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENTRY_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/

/** Names flow into config keys (TOML tables, JSON keys, env names), so keep them to a safe charset. */
export function isTopoMcpServerName(value: string): boolean {
  return SERVER_NAME.test(value)
}

export function isTopoMcpEntryKey(value: string): boolean {
  return ENTRY_KEY.test(value)
}

function boundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH
    ? value
    : undefined
}

function normalizeValues(value: unknown): Record<string, TopoMcpValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, TopoMcpValue> = {}
  for (const [key, raw] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    const entry = asRecord(raw)
    if (!isTopoMcpEntryKey(key) || !entry) {
      continue
    }
    if (entry.kind === 'secret') {
      out[key] = { kind: 'secret' }
    } else if (entry.kind === 'plain' && typeof entry.value === 'string') {
      if (entry.value.length <= MAX_FIELD_LENGTH) {
        out[key] = { kind: 'plain', value: entry.value }
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** One persisted server, or null when it is malformed (hand-edited file, older shape). */
export function normalizeTopoMcpServer(value: unknown): TopoMcpServer | null {
  const raw = asRecord(value)
  if (!raw) {
    return null
  }
  const id = boundedString(raw.id)
  const name = typeof raw.name === 'string' && isTopoMcpServerName(raw.name) ? raw.name : undefined
  const transport = raw.transport === 'http' ? 'http' : raw.transport === 'stdio' ? 'stdio' : null
  if (!id || !name || !transport) {
    return null
  }
  const server: TopoMcpServer = { id, name, enabled: raw.enabled !== false, transport }
  if (transport === 'stdio') {
    const command = boundedString(raw.command)
    if (!command) {
      return null
    }
    server.command = command
    if (Array.isArray(raw.args)) {
      const args = raw.args
        .filter((arg): arg is string => typeof arg === 'string' && arg.length <= MAX_FIELD_LENGTH)
        .slice(0, MAX_ARGS)
      if (args.length) {
        server.args = args
      }
    }
    const env = normalizeValues(raw.env)
    if (env) {
      server.env = env
    }
  } else {
    const url = boundedString(raw.url)
    if (!url || !/^https?:\/\//i.test(url)) {
      return null
    }
    server.url = url
    const headers = normalizeValues(raw.headers)
    if (headers) {
      server.headers = headers
    }
  }
  if (Array.isArray(raw.agents)) {
    const agents = [...new Set(raw.agents.filter(isTuiAgent))]
    if (agents.length) {
      server.agents = agents
    }
  }
  return server
}

/** The persisted list as valid servers with unique ids and names; later duplicates are dropped. */
export function normalizeTopoMcpServers(value: unknown): TopoMcpServer[] {
  if (!Array.isArray(value)) {
    return []
  }
  const ids = new Set<string>()
  const names = new Set<string>()
  const servers: TopoMcpServer[] = []
  for (const entry of value) {
    const server = normalizeTopoMcpServer(entry)
    if (!server || ids.has(server.id) || names.has(server.name)) {
      continue
    }
    ids.add(server.id)
    names.add(server.name)
    servers.push(server)
    if (servers.length >= TOPO_MCP_MAX_SERVERS) {
      break
    }
  }
  return servers
}
