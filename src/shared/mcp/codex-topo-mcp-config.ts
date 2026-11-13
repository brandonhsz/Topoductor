import type { ResolvedTopoMcpValue, TopoMcpLaunch } from './topo-mcp-resolution'

// JSON strings are valid TOML basic strings; names are restricted to TOML bare-key characters.
const tomlString = (value: string): string => JSON.stringify(value)
const tomlArray = (values: readonly string[]): string => `[${values.map(tomlString).join(',')}]`
const tomlTable = (entries: [string, string][]): string =>
  `{${entries.map(([key, value]) => `${key}=${tomlString(value)}`).join(',')}}`

function split(values: Record<string, ResolvedTopoMcpValue> | undefined): {
  plain: [string, string][]
  secret: [string, string][]
} {
  const plain: [string, string][] = []
  const secret: [string, string][] = []
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value.kind === 'plain') {
      plain.push([key, value.value])
    } else {
      secret.push([key, value.name])
    }
  }
  return { plain, secret }
}

/**
 * Codex `-c` overrides plus the env its process needs. Codex cannot expand env references in a
 * stdio server's env, so a secret travels under its own name and `env_vars` forwards it; HTTP
 * headers read Topo's env var directly through `env_http_headers`.
 */
export function codexTopoMcpLaunch(launch: TopoMcpLaunch): {
  configArgs: string[]
  env: Record<string, string>
} {
  const overrides: string[] = []
  const env: Record<string, string> = {}
  for (const server of launch.servers) {
    const root = `mcp_servers.${server.name}`
    if (server.transport === 'stdio' && server.command) {
      overrides.push(`${root}.command=${tomlString(server.command)}`)
      if (server.args?.length) {
        overrides.push(`${root}.args=${tomlArray(server.args)}`)
      }
      const { plain, secret } = split(server.env)
      if (plain.length) {
        overrides.push(`${root}.env=${tomlTable(plain)}`)
      }
      // Two servers wanting different values under one name cannot share a process env; the first wins.
      const forwarded = secret.filter(([key]) => !(key in env))
      for (const [key, envName] of forwarded) {
        env[key] = launch.env[envName]
      }
      if (forwarded.length) {
        overrides.push(`${root}.env_vars=${tomlArray(forwarded.map(([key]) => key))}`)
      }
    } else if (server.transport === 'http' && server.url) {
      overrides.push(`${root}.url=${tomlString(server.url)}`)
      const { plain, secret } = split(server.headers)
      if (plain.length) {
        overrides.push(`${root}.http_headers=${tomlTable(plain)}`)
      }
      if (secret.length) {
        overrides.push(`${root}.env_http_headers=${tomlTable(secret)}`)
        for (const [, envName] of secret) {
          env[envName] = launch.env[envName]
        }
      }
    }
  }
  return { configArgs: overrides.flatMap((override) => ['-c', override]), env }
}
