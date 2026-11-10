import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { AntigravityHookService } from './hook-service'
import { createManagedCommandMatcher } from '../agent-hooks/installation/commands/managed-hook-command-matching'

const ANTIGRAVITY_PRE_INVOCATION_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-invocation.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_POST_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-post-tool-use.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_PRE_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-tool-use.cmd' : 'antigravity-hook.sh'
const PRE_TOOL_USE_DECISION = '{"decision":"ask"}'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

describe('AntigravityHookService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'topo-antigravity-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    'answers the PreToolUse gate with ask so the hook never decides tool permissions',
    () => {
      new AntigravityHookService().install()

      const result = spawnSync(
        '/bin/sh',
        [join(homeDir, '.topo', 'agent-hooks', 'antigravity-hook.sh')],
        {
          env: {
            ...process.env,
            TOPO_ANTIGRAVITY_EVENT: 'PreToolUse',
            TOPO_AGENT_HOOK_ENDPOINT: '',
            TOPO_AGENT_HOOK_PORT: '',
            TOPO_AGENT_HOOK_TOKEN: '',
            TOPO_PANE_KEY: ''
          },
          input: '{"toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}',
          encoding: 'utf8'
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${PRE_TOOL_USE_DECISION}\n`)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps answering the PreToolUse gate when the managed script is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.topo', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as { 'topo-status': Record<string, { hooks?: { command: string }[] }[]> }
      const command = config['topo-status'].PreToolUse[0].hooks?.[0]?.command

      const result = spawnSync('/bin/sh', ['-c', command!], {
        input: '{"toolCall":{"name":"run_command"}}',
        encoding: 'utf8'
      })

      // Config under .gemini can outlive managed scripts under .topo.
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${PRE_TOOL_USE_DECISION}\n`)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'leaves non-gate Antigravity events silent when the managed script is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.topo', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as {
        'topo-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const postToolUse = config['topo-status'].PostToolUse[0].hooks?.[0]?.command
      const preInvocation = config['topo-status'].PreInvocation[0].command

      for (const command of [postToolUse, preInvocation]) {
        const result = spawnSync('/bin/sh', ['-c', command!], { input: '{}', encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('')
      }
    }
  )

  it('preserves the installed core and config when publishing the Windows reader fails', () => {
    withPlatform('win32', () => {
      const service = new AntigravityHookService()
      expect(service.install().state).toBe('installed')
      const hookDir = join(homeDir, '.topo', 'agent-hooks')
      const readerPath = join(hookDir, 'antigravity-hook-post.cjs')
      const corePath = join(hookDir, 'antigravity-hook.cmd')
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      writeFileSync(corePath, 'previous installed core')
      const previousConfig = readFileSync(configPath, 'utf8')
      rmSync(readerPath)
      mkdirSync(readerPath)

      expect(() => service.install()).toThrow()
      expect(readFileSync(corePath, 'utf8')).toBe('previous installed core')
      expect(readFileSync(configPath, 'utf8')).toBe(previousConfig)
    })
  })

  it('preserves user-authored hook bundles and entries in Topo bundle', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'user-hook': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
          },
          'topo-status': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/topo-extra' }]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'user-hook': { PreInvocation: { command: string }[] }
      'topo-status': { PreInvocation: { command: string }[] }
    }
    expect(config['user-hook'].PreInvocation[0].command).toBe('/usr/local/bin/user-hook')
    const commands = config['topo-status'].PreInvocation.map((entry) => entry.command)
    expect(commands).toContain('/usr/local/bin/topo-extra')
    expect(commands.some((command) => command.includes(ANTIGRAVITY_PRE_INVOCATION_COMMAND))).toBe(
      true
    )
  })

  it('removes stale managed Antigravity hook entries from retired events', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'topo-status': {
            OldEvent: [
              {
                type: 'command',
                command: '/tmp/old/agent-hooks/antigravity-hook.sh'
              }
            ],
            PreToolUse: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: '/tmp/old/agent-hooks/antigravity-hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'topo-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
    }
    expect(config['topo-status'].OldEvent).toBeUndefined()
    const preToolCommands = config['topo-status'].PreToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(preToolCommands).toHaveLength(1)
    expect(preToolCommands[0]).toContain(
      join(homeDir, '.topo', 'agent-hooks', ANTIGRAVITY_PRE_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
    expect(preToolCommands[0]).not.toContain('/tmp/old/agent-hooks/antigravity-hook.sh')
    const commands = config['topo-status'].PostToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(
      join(homeDir, '.topo', 'agent-hooks', ANTIGRAVITY_POST_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
  })

  it('replaces legacy backslash Windows entries and keeps user hooks', () => {
    withPlatform('win32', () => {
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      // Git Bash strips backslashes from legacy bare paths.
      const legacyStop = 'C:\\Users\\ada\\.topo\\agent-hooks\\antigravity-stop.cmd'
      const legacyPreToolUse = 'C:\\Users\\ada\\.topo\\agent-hooks\\antigravity-pre-tool-use.cmd'
      const userHook = { type: 'command', command: 'C:\\tools\\user-hook.cmd' }
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        `${JSON.stringify({
          'topo-status': {
            Stop: [{ type: 'command', command: legacyStop }, userHook],
            PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: legacyPreToolUse }] }]
          }
        })}\n`
      )

      const service = new AntigravityHookService()
      expect(service.getStatus().state).toBe('partial')
      expect(service.install().state).toBe('installed')

      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        'topo-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const [keptUserHook, stop] = config['topo-status'].Stop
      expect(config['topo-status'].Stop).toHaveLength(2)
      expect(keptUserHook).toEqual(userHook)
      expect(stop.command).not.toBe(legacyStop)
      expect(createManagedCommandMatcher('antigravity-stop.cmd')(stop.command)).toBe(true)
      const preToolUse = config['topo-status'].PreToolUse.flatMap((d) => d.hooks ?? [])
      expect(preToolUse).toHaveLength(1)
      expect(preToolUse[0].command).not.toBe(legacyPreToolUse)
    })
  })
})
