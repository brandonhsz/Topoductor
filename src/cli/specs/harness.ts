import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const CALLER_NOTE =
  'Run inside a workspace chat or terminal, it finds that workspace’s Harness flow on its own; --worktree overrides it.'

export const HARNESS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['harness', 'start'],
    summary: 'Start a Harness flow driven by this workspace chat',
    usage:
      'topo harness start --flow <id> [--field <key>=<value>]... [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'flow', 'field'],
    notes: [
      CALLER_NOTE,
      'Meant for chats that start a flow on their own, like a scheduled automation. Each --field fills a start field; required fields must be set.',
      'Prints the flow protocol and the first step: follow it with `topo harness status`, `complete` and `wait` until the flow ends.',
      'Fails with harness_run_active when this workspace already drives a flow.'
    ],
    examples: [
      'topo harness start --flow avenapm-ticket --field ticket=OP-142 --field correo=dev@example.com'
    ]
  },
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
    path: ['harness', 'flow', 'list'],
    summary: 'List the Harness flows this workspace can use',
    usage: 'topo harness flow list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      CALLER_NOTE,
      'A repo copy of a flow replaces the global one for that repo; only the copy is listed.'
    ],
    examples: ['topo harness flow list --json']
  },
  {
    path: ['harness', 'flow', 'show'],
    summary: 'Read a Harness flow with its diagram, problems and warnings',
    usage: 'topo harness flow show --flow <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'flow'],
    notes: [
      CALLER_NOTE,
      'Always read the flow with --json before editing it: result.flow is the HarnessFlow to edit and result.flow.updatedAt goes to save --expected-updated-at.',
      'Tell the person when affectsAllRepos is true (a global flow reaches every repo) or activeRuns > 0 (runs in progress keep their copy and do not change).'
    ],
    examples: [
      'topo harness flow show --flow flow-entrega',
      'topo harness flow show --flow flow-entrega --json'
    ]
  },
  {
    path: ['harness', 'flow', 'save'],
    summary: 'Create or change a Harness flow from a JSON file; every save is a version',
    usage:
      'topo harness flow save --file <flow.json> --summary <text> [--expected-updated-at <n>] [--scope global|repo] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'file', 'summary', 'expected-updated-at', 'scope'],
    notes: [
      CALLER_NOTE,
      '--file holds the whole HarnessFlow as JSON, read on this machine. Start from `show --json` result.flow; omit id to create a new flow.',
      'Pass --expected-updated-at with the updatedAt you read; if someone changed the flow since, the save fails with harness_flow_conflict: read again, reapply and retry.',
      '--summary says what changed and why (max 500 chars); the person sees it in the version history and can restore the previous version.',
      '--scope only applies when creating (default: the caller’s repo, or global outside a repo).',
      'Runs in progress do not change: they keep the copy they started with. Tell the person when the result reports affectsAllRepos or activeRuns > 0, and fix any problems it lists.'
    ],
    examples: [
      'topo harness flow save --file flow.json --summary "Agrega revisión de seguridad" --expected-updated-at 1763400000000',
      'topo harness flow save --file new-flow.json --summary "Flujo de soporte" --scope repo'
    ]
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
