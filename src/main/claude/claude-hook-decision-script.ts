import { CLAUDE_PRE_TOOL_USE_DECISION } from '../agent-hooks/tool-events/agent-tool-plugin-hooks'

/**
 * Lets Claude Code's PreToolUse hook print Topo's answer (plugins' `agent.tool.before`) instead of
 * a fixed `{}`. Every other event still prints `{}` before it posts, as permission hooks need. The
 * answer is printed only when it is a PreToolUse decision; a timeout, an error or no answer prints
 * `{}`, so the tool call proceeds as if Topo were not there.
 */
export function buildPosixClaudeDecisionPreludeLines(): string[] {
  return [
    'topo_hook_printed=',
    'topo_hook_answer=',
    'topo_hook_decides=',
    // An early exit (a skip path) still prints the `{}` Claude Code needs.
    'topo_hook_finish() {',
    '  [ -z "$topo_hook_printed" ] || return 0',
    '  if [ -n "$topo_hook_answer" ]; then printf \'%s\\n\' "$topo_hook_answer"; else printf \'{}\\n\'; fi',
    '}',
    'trap topo_hook_finish EXIT'
  ]
}

export function buildPosixClaudeDecisionModeLines(): string[] {
  return [
    'case "$payload" in',
    `  *'"hook_event_name":"PreToolUse"'*|*'"hook_event_name": "PreToolUse"'*) topo_hook_decides=${CLAUDE_PRE_TOOL_USE_DECISION}; max_time=8 ;;`,
    "  *) printf '{}\\n'; topo_hook_printed=1 ;;",
    'esac'
  ]
}

/** Captures the post's reply; a failed curl's partial body is dropped, spooled and answered `{}`. */
export function wrapPosixClaudeDecisionPost(postLines: readonly string[]): string[] {
  return [
    ...postLines.map((line, index) =>
      index === 0
        ? `topo_hook_reply=$(${line}`
        : index === postLines.length - 1
          ? `${line} 2>/dev/null) || { topo_hook_reply=; spool_hook_event; }`
          : line
    ),
    'case "$topo_hook_reply" in \'{"hookSpecificOutput":{"hookEventName":"PreToolUse"\'*\'}}\') topo_hook_answer=$topo_hook_reply ;; esac'
  ]
}
