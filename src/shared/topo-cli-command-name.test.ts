import { describe, expect, it } from 'vitest'
import { installFakeAppEnvironment } from '../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './agent-launch/catalog/tui-agent-config'

const agentTeams = TUI_AGENT_CONFIG['claude-agent-teams']

describe('Claude Agent Teams launch name on the launching host', () => {
  it('uses plain topo on a headless Linux server, whose PATH has no topo-ide (#33920)', () => {
    installFakeAppEnvironment({ getCliLauncherPath: () => '/home/u/.topo/cli/bin/topo' })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('topo claude-teams')
  })

  it('keeps the topo-ide rename for WSL under a Windows server', () => {
    installFakeAppEnvironment({
      getCliLauncherPath: () => 'C:\\Users\\u\\.topo\\cli\\bin\\topo.exe'
    })
    expect(getTuiAgentLaunchCommand(agentTeams, 'linux')).toBe('topo-ide claude-teams')
  })
})
