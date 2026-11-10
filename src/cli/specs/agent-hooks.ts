import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Topo-managed Codex home before a shell launch",
    usage: 'topo agent hooks prepare-codex',
    allowedFlags: [...LOCAL_COMMAND_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Topo-managed agent status hooks are enabled',
    usage: 'topo agent hooks status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['topo agent hooks status', 'topo agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Topo-managed agent status hooks and remove local hook entries',
    usage: 'topo agent hooks off [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['topo agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Topo-managed agent status hooks',
    usage: 'topo agent hooks on [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['topo agent hooks on']
  }
]
