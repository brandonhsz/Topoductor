import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { claudeTopoMcpConfig } from '../../shared/mcp/claude-topo-mcp-config'
import type { ResolvedTopoMcpServer } from '../../shared/mcp/topo-mcp-resolution'

export const CLAUDE_TOPO_MCP_PLUGIN = 'topo-mcp'

/** A Claude plugin whose `.mcp.json` carries Topo's servers; content-hashed so concurrent launches never rewrite a live one. */
export async function ensureClaudeTopoMcpPlugin(
  userDataPath: string,
  servers: readonly ResolvedTopoMcpServer[]
): Promise<string | null> {
  if (!servers.length) {
    return null
  }
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: CLAUDE_TOPO_MCP_PLUGIN,
      version: '1.0.0',
      description: 'MCP servers configured in Topo'
    }),
    '.mcp.json': JSON.stringify(claudeTopoMcpConfig(servers), null, 2)
  }
  const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 20)
  const root = join(userDataPath, 'topo-mcp', 'claude', version, CLAUDE_TOPO_MCP_PLUGIN)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return root
}
