import { describe, expect, it, vi } from 'vitest'
import { claudeHarnessLaunchOptions } from './claude-harness-launch-options'

const RECORD = { sessionId: 'chat-7', location: { workspaceId: 'ws-1' } }

describe('claudeHarnessLaunchOptions', () => {
  it('installs the edit guard and the subagent capture hook for a Harness chat', async () => {
    const resolve = vi.fn().mockResolvedValue('Sigue el flujo.')

    const { options, extraArgs } = await claudeHarnessLaunchOptions(resolve, RECORD)

    expect(resolve).toHaveBeenCalledWith('ws-1', 'chat-7')
    expect(options.systemPrompt?.append).toBe('Sigue el flujo.')
    const settings = JSON.parse(extraArgs.settings)
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: '"$TOPO_CLI_COMMAND" harness guard' }]
      }
    ])
    expect(settings.hooks.PostToolUse).toEqual([
      {
        matcher: 'Agent|Task',
        hooks: [{ type: 'command', command: '"$TOPO_CLI_COMMAND" harness capture' }]
      }
    ])
  })

  it('adds nothing when the chat is not driving a Harness flow', async () => {
    const result = await claudeHarnessLaunchOptions(vi.fn().mockResolvedValue(null), RECORD)

    expect(result).toEqual({ options: {}, extraArgs: {} })
  })
})
