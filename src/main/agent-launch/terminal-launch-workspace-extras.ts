import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { AgentStartupShell } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { getAppEnvironment } from '../../shared/app-environment'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { applyHarnessToTerminalLaunch } from '../harness/harness-terminal-launch'
import { applyTopoMcpToTerminalLaunch } from '../mcp/topo-mcp-launch'
import { repoForAgentWorkspace } from './trust/agent-workspace-trust-spawn'

/** What a workspace adds to a terminal agent's launch: its Topo MCP servers and its Harness flow. */
export async function applyWorkspaceExtrasToTerminalLaunch(args: {
  agent: TuiAgent
  settings: Pick<GlobalSettings, 'topoMcpServers'> | undefined
  worktreeId: string | undefined
  store: Parameters<typeof repoForAgentWorkspace>[1]
  paneKey: string | null | undefined
  cwd: string | undefined
  command: string
  env: Record<string, string> | undefined
  shell: AgentStartupShell
}): Promise<{ command: string; env: Record<string, string> | undefined }> {
  const userDataPath = getAppEnvironment().getPath('userData')
  const mcp = await applyTopoMcpToTerminalLaunch({
    agent: args.agent,
    settings: args.settings,
    repo: repoForAgentWorkspace(args.worktreeId, args.store),
    userDataPath,
    cwd: args.cwd,
    command: args.command,
    env: args.env,
    shell: args.shell
  })
  const command = args.worktreeId
    ? await applyHarnessToTerminalLaunch({
        agent: args.agent,
        worktreeId: args.worktreeId,
        paneKey: args.paneKey ?? null,
        userDataPath,
        command: mcp.command,
        shell: args.shell
      })
    : mcp.command
  return { command, env: mcp.env }
}
