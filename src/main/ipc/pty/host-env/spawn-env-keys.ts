import { TOPO_AGENT_SESSION_ID_ENV } from '../../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { TOPO_STRUCTURED_SESSION_ENV } from '../../../../shared/structured-session-marker'
import {
  TOPO_SCRUB_SAFE_LAUNCH_ENV,
  TOPO_SCRUB_SAFE_PANE_ENV
} from '../../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'

export const AGENT_HOOK_RUNTIME_ENV_KEYS = [
  'TOPO_AGENT_HOOK_PORT',
  'TOPO_AGENT_HOOK_TOKEN',
  'TOPO_AGENT_HOOK_ENV',
  'TOPO_AGENT_HOOK_VERSION',
  'TOPO_AGENT_HOOK_TRANSPORT',
  'TOPO_AGENT_HOOK_ENDPOINT',
  // Remove the reverted inherited path still present in older PTYs (#2778).
  'TOPO_CLAUDE_AGENT_STATUS_SETTINGS'
] as const

export const AGENT_PANE_HOOK_ENV_KEYS = [
  'TOPO_PANE_KEY',
  'TOPO_TAB_ID',
  'TOPO_WORKTREE_ID',
  'TOPO_AGENT_LAUNCH_TOKEN',
  TOPO_SCRUB_SAFE_PANE_ENV,
  TOPO_SCRUB_SAFE_LAUNCH_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS
] as const

// Inherited Claude child stamps make an independent pane act as the launching session's child.
export const CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_ENTRYPOINT'
] as const

// Inherited structured-session IDs would make every pane claim the parent orchestration caller.
export const TOPO_AGENT_SESSION_CALLER_ENV_KEYS = [
  TOPO_AGENT_SESSION_ID_ENV,
  TOPO_STRUCTURED_SESSION_ENV
] as const
