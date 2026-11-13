import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { withCodexArgs } from '../../shared/agent-launch/startup/tui-agent-launch-command'
import type { AgentStartupShell } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { withClaudePluginDir } from '../../shared/claude-plugin-dir-launch'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { codexTopoMcpLaunch } from '../../shared/mcp/codex-topo-mcp-config'
import {
  buildTopoMcpLaunch,
  resolveTopoMcpServers,
  type TopoMcpLaunch
} from '../../shared/mcp/topo-mcp-resolution'
import type { Repo } from '../../shared/repo-types'
import { ensureClaudeTopoMcpPlugin } from './claude-topo-mcp-plugin'
import { syncCursorTopoMcpFile } from './cursor-topo-mcp-file'
import { readTopoMcpSecret } from './topo-mcp-secret-vault'

/** Agents whose launches Topo can hand MCP servers to. */
const TOPO_MCP_AGENTS: ReadonlySet<TuiAgent> = new Set([
  'claude',
  'claude-agent-teams',
  'codex',
  'cursor'
])

type TopoMcpScope = {
  settings: Pick<GlobalSettings, 'topoMcpServers'> | undefined
  repo: Pick<Repo, 'mcpServers'> | undefined
}

export function resolveTopoMcpLaunch(
  args: TopoMcpScope & { agent: TuiAgent }
): TopoMcpLaunch | null {
  if (!TOPO_MCP_AGENTS.has(args.agent)) {
    return null
  }
  const servers = resolveTopoMcpServers({
    global: args.settings?.topoMcpServers,
    repo: args.repo?.mcpServers,
    agent: args.agent
  })
  return servers.length ? buildTopoMcpLaunch(servers, readTopoMcpSecret) : null
}

/** Claude's plugin folder for this launch plus the secret env it expands; null when nothing applies. */
export async function prepareClaudeTopoMcp(
  args: TopoMcpScope & { agent?: TuiAgent; userDataPath: string }
): Promise<{ pluginDir: string; env: Record<string, string> } | null> {
  const launch = resolveTopoMcpLaunch({ ...args, agent: args.agent ?? 'claude' })
  const pluginDir = launch
    ? await ensureClaudeTopoMcpPlugin(args.userDataPath, launch.servers)
    : null
  return launch && pluginDir ? { pluginDir, env: launch.env } : null
}

/** Codex `-c` overrides for this launch plus the env they read; null when nothing applies. */
export function prepareCodexTopoMcp(
  args: TopoMcpScope
): { configArgs: string[]; env: Record<string, string> } | null {
  const launch = resolveTopoMcpLaunch({ ...args, agent: 'codex' })
  return launch ? codexTopoMcpLaunch(launch) : null
}

/** Terminal launches get the servers through the command line; secrets ride only in the env. */
export async function applyTopoMcpToTerminalLaunch(
  args: TopoMcpScope & {
    agent: TuiAgent
    userDataPath: string
    /** The folder the agent starts in; Cursor reads MCP servers only from a file there. */
    cwd: string | undefined
    command: string
    env: Record<string, string> | undefined
    shell: AgentStartupShell
  }
): Promise<{ command: string; env: Record<string, string> | undefined }> {
  if (args.agent === 'cursor') {
    return applyTopoMcpToCursorLaunch(args)
  }
  let prepared: { command: string; env: Record<string, string> } | null = null
  if (args.agent === 'codex') {
    const codex = prepareCodexTopoMcp(args)
    prepared = codex
      ? { command: withCodexArgs(args.command, codex.configArgs, args.shell), env: codex.env }
      : null
  } else {
    const claude = await prepareClaudeTopoMcp(args)
    prepared = claude
      ? {
          command: withClaudePluginDir(args.command, claude.pluginDir, args.shell),
          env: claude.env
        }
      : null
  }
  // A command the helpers could not safely extend gets neither the servers nor their secrets.
  return prepared && prepared.command !== args.command
    ? { command: prepared.command, env: { ...args.env, ...prepared.env } }
    : { command: args.command, env: args.env }
}

// Runs even with no servers so entries Topo wrote on an earlier launch are removed.
async function applyTopoMcpToCursorLaunch(
  args: TopoMcpScope & {
    userDataPath: string
    cwd: string | undefined
    command: string
    env: Record<string, string> | undefined
  }
): Promise<{ command: string; env: Record<string, string> | undefined }> {
  const unchanged = { command: args.command, env: args.env }
  if (!args.cwd) {
    return unchanged
  }
  const launch = resolveTopoMcpLaunch({ ...args, agent: 'cursor' })
  try {
    const sync = await syncCursorTopoMcpFile({
      folder: args.cwd,
      userDataPath: args.userDataPath,
      servers: launch?.servers ?? []
    })
    if (sync.kind === 'skipped') {
      console.warn(`[topo-mcp] left .cursor/mcp.json unchanged (${sync.reason})`)
      return unchanged
    }
  } catch (error) {
    // A launch never fails over MCP setup; the agent starts with its own config.
    console.warn('[topo-mcp] could not write .cursor/mcp.json', error)
    return unchanged
  }
  return launch ? { command: args.command, env: { ...args.env, ...launch.env } } : unchanged
}
