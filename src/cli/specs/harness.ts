import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const CALLER_NOTE =
  'Run inside a workspace chat or terminal, it finds that workspace’s Harness flow on its own; --worktree overrides it.'

export const HARNESS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['harness', 'status'],
    summary: 'Show your current Harness step and any decision waiting on the person',
    usage: 'topo harness status [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [CALLER_NOTE],
    examples: ['topo harness status']
  },
  {
    path: ['harness', 'complete'],
    summary: 'Report a Harness task as done and get the next step',
    usage:
      'topo harness complete --task <id> (--output-file <path> | --output <text>) [--outcome <label>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'task', 'output', 'output-file', 'outcome'],
    notes: [
      CALLER_NOTE,
      'The output is the step’s deliverable; Topo passes it to the next steps. Use --outcome with one of the options the task lists.'
    ],
    examples: [
      'topo harness complete --task run-1-c3 --output-file idea.md',
      'topo harness complete --task run-1-c5 --output-file plan.md --outcome "Aprobada"'
    ]
  },
  {
    path: ['harness', 'wait'],
    summary: 'Wait until Topo gives you a Harness task or the person decides',
    usage: 'topo harness wait [--timeout <seconds>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'timeout'],
    notes: [
      CALLER_NOTE,
      'Returns after at most --timeout seconds (default 300); run it again if nothing changed.'
    ],
    examples: ['topo harness wait', 'topo harness wait --timeout 600']
  },
  {
    path: ['harness', 'guard'],
    summary: 'PreToolUse hook: deny file edits the current Harness step does not allow',
    usage: 'topo harness guard < hook-payload.json',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Topo installs this as a Claude PreToolUse hook for chats that drive a Harness flow. It reads the hook payload from stdin, prints a deny decision when the step forbids editing, and otherwise prints nothing. It never blocks on errors.'
    ],
    examples: ['topo harness guard < payload.json']
  },
  {
    path: ['harness', 'capture'],
    summary: 'PostToolUse hook: hand a Harness subagent’s exact prompt and reply to Topo',
    usage: 'topo harness capture < hook-payload.json',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Topo installs this as a Claude PostToolUse hook on the subagent tool for chats that drive a Harness flow. Only prompts carrying a Harness task marker are sent; a rejection is fed back to the chat. It never blocks on errors.'
    ],
    examples: ['topo harness capture < payload.json']
  },
  {
    path: ['harness', 'answer'],
    summary: 'Record the person’s answer to a Harness decision',
    usage:
      'topo harness answer --decision <id> [--choice <option>] [--text <answer>] [--field <key>=<value>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'decision', 'choice', 'text', 'field'],
    notes: [
      CALLER_NOTE,
      'Only record what the person said; never decide for them.',
      'A restart decision takes the new start values with --field (e.g. --field intent=...); without them --text becomes the first required field.'
    ],
    examples: [
      'topo harness answer --decision run-1-d2 --choice "Idea consolidada" --text "Sí, adelante"',
      'topo harness answer --decision run-1-d3 --field intent="Una sola pestaña"'
    ]
  }
]
