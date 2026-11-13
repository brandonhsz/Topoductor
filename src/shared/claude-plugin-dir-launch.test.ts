import { expect, it } from 'vitest'
import { withClaudePluginDir } from './claude-plugin-dir-launch'
import {
  tokenizeStartupCommand,
  type AgentStartupShell
} from './agent-launch/startup/tui-agent-startup-shell'

it.each(['posix', 'powershell', 'cmd'] as const)(
  'preserves existing plugin arguments and prompts in %s',
  (shell: AgentStartupShell) => {
    const command = 'claude --plugin-dir user-plugin --resume session -- "my prompt"'
    const result = withClaudePluginDir(command, 'topo plugin', shell)
    const parsed = tokenizeStartupCommand(result, shell)
    expect(parsed.ok && parsed.tokens).toEqual([
      'claude',
      '--plugin-dir',
      'topo plugin',
      '--plugin-dir',
      'user-plugin',
      '--resume',
      'session',
      '--',
      'my prompt'
    ])
  }
)

it.each(['ssh host claude', 'bash -c claude', 'echo /bin/claude', 'claude && echo done'])(
  'leaves shell syntax and ambiguous executables unchanged: %s',
  (command) => {
    expect(withClaudePluginDir(command, '/topo/plugin', 'posix')).toBe(command)
  }
)
