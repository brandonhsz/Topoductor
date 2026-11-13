import { describe, expect, it } from 'vitest'
import { mergeCursorTopoMcpConfig } from './cursor-topo-mcp-config'

const github = {
  id: 'a',
  name: 'github',
  enabled: true,
  transport: 'stdio' as const,
  command: 'npx',
  env: { TOKEN: { kind: 'env' as const, name: 'TOPO_MCP_0_E_TOKEN' } }
}

describe('mergeCursorTopoMcpConfig', () => {
  it('keeps the user servers, drops ones Topo wrote before, and references secrets by env', () => {
    const merged = mergeCursorTopoMcpConfig({
      existing: JSON.stringify({
        mcpServers: {
          mine: { command: 'mine' },
          stale: { command: 'old' },
          github: { command: 'x' }
        }
      }),
      previouslyManaged: ['stale'],
      createdByTopo: false,
      servers: [github]
    })
    expect(merged.kind === 'write' && JSON.parse(merged.content ?? '')).toEqual({
      mcpServers: {
        mine: { command: 'mine' },
        github: { command: 'npx', env: { TOKEN: '${env:TOPO_MCP_0_E_TOKEN}' } }
      }
    })
  })

  it('removes a file only Topo ever wrote once its servers are gone', () => {
    expect(
      mergeCursorTopoMcpConfig({
        existing: JSON.stringify({ mcpServers: { github: { command: 'npx' } } }),
        previouslyManaged: ['github'],
        createdByTopo: true,
        servers: []
      })
    ).toEqual({ kind: 'write', content: null, managedNames: [] })
  })

  it('never rewrites a file it cannot parse', () => {
    expect(
      mergeCursorTopoMcpConfig({
        existing: '{ not json',
        previouslyManaged: [],
        createdByTopo: false,
        servers: [github]
      })
    ).toEqual({ kind: 'unchanged' })
  })
})
