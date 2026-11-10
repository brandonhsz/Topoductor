import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Topo detected for a workspace',
    usage: 'topo ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Topo workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Topo tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Topo could not tie to one. A native folder workspace needs --all, because Topo does not tie ports to folders.',
      'url is the address the dev server printed in a Topo terminal; it is missing when Topo did not see one.'
    ],
    examples: [
      'topo ports',
      'topo ports --worktree branch:feature/login --json',
      'topo ports --all',
      "topo ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
