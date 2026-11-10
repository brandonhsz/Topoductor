import { delimiter } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { applyClaudeAgentViewEnv } from './claude-agent-view'
import type { BuildPtyHostEnvOptions } from './types'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../../claude/agent-view/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ read })
}))

const options: BuildPtyHostEnvOptions = {
  userDataPath: '/topo',
  isPackaged: false,
  selectedCodexHomePath: null,
  agentStatusHooksEnabled: true
}

afterEach(() => {
  vi.unstubAllEnvs()
  read.mockReset()
})

it('strips only a previously inherited Topo path when disabled', () => {
  vi.stubEnv('TOPO_CLAUDE_AGENT_VIEW_PLUGIN_DIR', '/topo/previous')
  vi.stubEnv('CLAUDE_CODE_PLUGIN_DIRS', `/user/plugin${delimiter}/topo/previous`)
  const env = {}
  applyClaudeAgentViewEnv(env, { ...options, claudeSubagentNavigationEnabled: false })
  expect(env).toEqual({ CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin' })
})
