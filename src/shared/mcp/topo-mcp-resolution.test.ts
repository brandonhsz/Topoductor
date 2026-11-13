import { describe, expect, it } from 'vitest'
import { claudeTopoMcpConfig } from './claude-topo-mcp-config'
import { buildTopoMcpLaunch, resolveTopoMcpServers } from './topo-mcp-resolution'
import type { TopoMcpServer } from './topo-mcp-server-types'

const stdio = (id: string, name: string, extra: Partial<TopoMcpServer> = {}): TopoMcpServer => ({
  id,
  name,
  enabled: true,
  transport: 'stdio',
  command: `${id}-cmd`,
  ...extra
})

describe('resolveTopoMcpServers', () => {
  it('lets a repo server replace the same-named global one and drops disabled or other-agent entries', () => {
    const servers = resolveTopoMcpServers({
      global: [
        stdio('g1', 'github'),
        stdio('g2', 'linear'),
        stdio('g3', 'off', { enabled: false }),
        stdio('g4', 'codex-only', { agents: ['codex'] })
      ],
      repo: [stdio('r1', 'github')],
      agent: 'claude'
    })
    expect(servers.map((server) => server.id)).toEqual(['r1', 'g2'])
  })
})

describe('buildTopoMcpLaunch', () => {
  it('keeps secrets out of the Claude config and in the launch env', () => {
    const launch = buildTopoMcpLaunch(
      [
        stdio('s1', 'github', {
          env: { TOKEN: { kind: 'secret' }, MODE: { kind: 'plain', value: 'ro' } }
        }),
        {
          id: 's2',
          name: 'remote',
          enabled: true,
          transport: 'http',
          url: 'https://x.test/mcp',
          headers: { Authorization: { kind: 'secret' } }
        }
      ],
      (key) => (key === 's1:env:TOKEN' ? 'ghp_secret' : null)
    )
    expect(launch.env).toEqual({ TOPO_MCP_0_E_TOKEN: 'ghp_secret' })
    expect(claudeTopoMcpConfig(launch.servers)).toEqual({
      mcpServers: {
        github: { command: 's1-cmd', env: { TOKEN: '${TOPO_MCP_0_E_TOKEN}', MODE: 'ro' } },
        remote: { type: 'http', url: 'https://x.test/mcp' }
      }
    })
  })
})
