import { describe, expect, it } from 'vitest'
import { codexTopoMcpLaunch } from './codex-topo-mcp-config'

describe('codexTopoMcpLaunch', () => {
  it('forwards stdio secrets by their own name and reads HTTP secrets from Topo env vars', () => {
    const { configArgs, env } = codexTopoMcpLaunch({
      servers: [
        {
          id: 'a',
          name: 'github',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'gh mcp'],
          env: {
            MODE: { kind: 'plain', value: 'ro' },
            TOKEN: { kind: 'env', name: 'TOPO_MCP_0_E_TOKEN' }
          }
        },
        {
          id: 'b',
          name: 'remote',
          enabled: true,
          transport: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: { kind: 'env', name: 'TOPO_MCP_1_H_AUTHORIZATION' } }
        }
      ],
      env: { TOPO_MCP_0_E_TOKEN: 'ghp_secret', TOPO_MCP_1_H_AUTHORIZATION: 'Bearer z' }
    })
    expect(configArgs).toEqual([
      '-c',
      'mcp_servers.github.command="npx"',
      '-c',
      'mcp_servers.github.args=["-y","gh mcp"]',
      '-c',
      'mcp_servers.github.env={MODE="ro"}',
      '-c',
      'mcp_servers.github.env_vars=["TOKEN"]',
      '-c',
      'mcp_servers.remote.url="https://x.test/mcp"',
      '-c',
      'mcp_servers.remote.env_http_headers={Authorization="TOPO_MCP_1_H_AUTHORIZATION"}'
    ])
    expect(env).toEqual({ TOKEN: 'ghp_secret', TOPO_MCP_1_H_AUTHORIZATION: 'Bearer z' })
    expect(configArgs.join(' ')).not.toContain('ghp_secret')
  })
})
