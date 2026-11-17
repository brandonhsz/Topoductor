// The guard asks Topo before each edit (a step may forbid edits); capture hands Topo each Harness subagent's exact prompt and reply.
const HARNESS_GUARD_SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: '"$TOPO_CLI_COMMAND" harness guard' }]
      }
    ],
    PostToolUse: [
      {
        matcher: 'Agent|Task',
        hooks: [{ type: 'command', command: '"$TOPO_CLI_COMMAND" harness capture' }]
      }
    ]
  }
})

/** SDK options for a chat that drives a Harness flow: its instructions plus the edit guard. */
export async function claudeHarnessLaunchOptions(
  resolve: ((workspaceId: string, sessionId: string) => Promise<string | null>) | undefined,
  record: { sessionId: string; location: { workspaceId: string } }
): Promise<{
  options: { systemPrompt?: { type: 'preset'; preset: 'claude_code'; append: string } }
  extraArgs: Record<string, string>
}> {
  const append = (await resolve?.(record.location.workspaceId, record.sessionId)) ?? null
  return append
    ? {
        options: { systemPrompt: { type: 'preset', preset: 'claude_code', append } },
        extraArgs: { settings: HARNESS_GUARD_SETTINGS }
      }
    : { options: {}, extraArgs: {} }
}
