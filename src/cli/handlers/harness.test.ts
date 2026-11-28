import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, specPaths } from '../args'
import { getRepeatedStringFlag } from '../flags'
import { cliErrorExitCode } from '../cli-exit-code'
import { reportCliError } from '../format'
import { RuntimeRpcFailureError, type RuntimeClient } from '../runtime-client'
import { HARNESS_COMMAND_SPECS } from '../specs/harness'
import { HARNESS_HANDLERS } from './harness'

const MARKED_PROMPT = 'Revisa el plan.\n[topo-harness-task:critic-1]'

function harnessClient(result: unknown = { taskId: 'critic-1', reason: null }): {
  client: RuntimeClient
  call: ReturnType<typeof vi.fn>
} {
  const call = vi.fn().mockResolvedValue({
    id: 'req-1',
    ok: true,
    result,
    _meta: { runtimeId: 'runtime-1' }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only use call and isRemote
  return { client: { call, isRemote: false } as unknown as RuntimeClient, call }
}

function pipeStdin(payload: unknown): void {
  const stream = Readable.from([JSON.stringify(payload)])
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
}

function agentPayload(
  prompt: string,
  toolResponse: Record<string, unknown> = {
    status: 'completed',
    prompt,
    agentId: 'a9b0',
    content: [
      { type: 'text', text: '<tools-used-before-summary>Write</tools-used-before-summary>\n' },
      { type: 'text', text: 'FINAL TEXT' }
    ]
  }
): unknown {
  return {
    tool_name: 'Agent',
    tool_input: {
      description: 'Critic',
      prompt,
      subagent_type: 'general-purpose',
      run_in_background: false
    },
    tool_response: toolResponse
  }
}

function capture(client: RuntimeClient): Promise<void> {
  return HARNESS_HANDLERS['harness capture']({
    flags: new Map(),
    client,
    cwd: '/tmp/worktree',
    json: false
  })
}

function printedJson(log: ReturnType<typeof vi.spyOn>): unknown[] {
  return log.mock.calls.map((args) => JSON.parse(String(args[0])))
}

describe('harness capture', () => {
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubEnv('TOPO_AGENT_SESSION_ID', 'chat-7')
    vi.stubEnv('TOPO_WORKTREE_ID', '')
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalStdin) {
      Object.defineProperty(process, 'stdin', originalStdin)
    }
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('sends the exact prompt and the final text without the tools-used summary', async () => {
    pipeStdin(agentPayload(MARKED_PROMPT))
    const { client, call } = harnessClient()

    await capture(client)

    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0][0]).toBe('harness.subagentResult')
    expect(call.mock.calls[0][1]).toEqual({
      sessionId: 'chat-7',
      prompt: MARKED_PROMPT,
      output: 'FINAL TEXT'
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('joins several final text blocks with a newline', async () => {
    pipeStdin(
      agentPayload(MARKED_PROMPT, {
        status: 'completed',
        content: [
          { type: 'text', text: 'Parte 1' },
          { type: 'text', text: '<tools-used-before-summary>Read</tools-used-before-summary>' },
          { type: 'text', text: 'Parte 2' }
        ]
      })
    )
    const { client, call } = harnessClient()

    await capture(client)

    expect(call.mock.calls[0][1]).toMatchObject({ output: 'Parte 1\nParte 2' })
  })

  it('feeds a rejection reason back to the chat as a PostToolUse block', async () => {
    pipeStdin(agentPayload(MARKED_PROMPT))
    const { client } = harnessClient({ taskId: null, reason: 'x' })

    await capture(client)

    expect(printedJson(log)).toEqual([{ decision: 'block', reason: 'x' }])
  })

  it('asks for a foreground relaunch when a Harness subagent ran in the background', async () => {
    pipeStdin(
      agentPayload(MARKED_PROMPT, {
        isAsync: true,
        status: 'async_launched',
        agentId: 'a9b0',
        prompt: MARKED_PROMPT
      })
    )
    const { client, call } = harnessClient()

    await capture(client)

    expect(call).not.toHaveBeenCalled()
    const printed = printedJson(log)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatchObject({ decision: 'block' })
    expect(printed[0]).toMatchObject({ reason: expect.stringContaining('primer plano') })
  })

  it('ignores subagents that are not Harness tasks', async () => {
    pipeStdin(agentPayload('Busca dónde se define X.'))
    const { client, call } = harnessClient()

    await capture(client)

    expect(call).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('fails open when Topo is unreachable', async () => {
    pipeStdin(agentPayload(MARKED_PROMPT))
    const { client, call } = harnessClient()
    call.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(capture(client)).resolves.toBeUndefined()
    expect(log).not.toHaveBeenCalled()
  })
})

describe('harness answer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('sends --field key=value pairs as fields', async () => {
    vi.stubEnv('TOPO_AGENT_SESSION_ID', 'chat-7')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client, call } = harnessClient({ state: 'running' })

    await HARNESS_HANDLERS['harness answer']({
      flags: new Map([
        ['decision', 'decision-1'],
        ['field', 'intent=Nuevo intent']
      ]),
      client,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call.mock.calls[0][0]).toBe('harness.answer')
    expect(call.mock.calls[0][1]).toMatchObject({
      sessionId: 'chat-7',
      decisionId: 'decision-1',
      fields: { intent: 'Nuevo intent' }
    })
  })
})

describe('harness start', () => {
  beforeEach(() => {
    vi.stubEnv('TOPO_AGENT_SESSION_ID', 'chat-7')
    vi.stubEnv('TOPO_WORKTREE_ID', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('starts the flow with its fields and prints the protocol before the first step', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client, call } = harnessClient({
      instructions: '# Flujo de trabajo: Tickets',
      status: {
        runId: 'run-1',
        flowName: 'Tickets',
        status: 'running',
        tasks: [],
        decisions: [],
        topoWorking: false,
        error: null
      }
    })
    await HARNESS_HANDLERS['harness start']({
      flags: new Map<string, string | boolean>([
        ['flow', 'avenapm-ticket'],
        ['field', 'ticket=OP-142']
      ]),
      client,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('harness.start', {
      sessionId: 'chat-7',
      flowId: 'avenapm-ticket',
      fields: { ticket: 'OP-142' }
    })
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^# Flujo de trabajo: Tickets/)
  })

  it.each([['start'], ['answer']])('keeps every --field given to harness %s', (command) => {
    const paths = HARNESS_COMMAND_SPECS.flatMap(specPaths)
    const parsed = parseArgs(
      ['harness', command, '--field', 'ticket=OP-142', '--field=correo=dev@example.com'],
      paths,
      HARNESS_COMMAND_SPECS
    )
    expect(getRepeatedStringFlag(parsed.flags, 'field')).toEqual([
      'ticket=OP-142',
      'correo=dev@example.com'
    ])
  })
})

describe('harness complete', () => {
  const rejection =
    'harness_outcome_required: la tarea run-c1 necesita --outcome. Salidas válidas: «Hay hallazgos», «Todo cumple». La tarea sigue abierta; reintenta: topo harness complete --task run-c1 --output-file <archivo con tu entregable> --outcome "<Hay hallazgos | Todo cumple>"'

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  /** Runs `harness complete` without --outcome against a runtime that rejects it, then reports like the CLI does. */
  async function rejectedComplete(json: boolean): Promise<{
    log: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
    exitCode: number
  }> {
    vi.stubEnv('TOPO_AGENT_SESSION_ID', 'chat-7')
    const failure = new RuntimeRpcFailureError({
      id: 'req-1',
      ok: false,
      error: { code: 'runtime_error', message: rejection },
      _meta: { runtimeId: 'runtime-1' }
    })
    const { client, call } = harnessClient()
    call.mockReset().mockRejectedValue(failure)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const caught = await HARNESS_HANDLERS['harness complete']({
      flags: new Map([
        ['task', 'run-c1'],
        ['output', 'Listo']
      ]),
      client,
      cwd: '/tmp/worktree',
      json
    }).catch((thrown: unknown) => thrown)
    expect(caught).toBe(failure)
    expect(call.mock.calls[0]![1]).not.toHaveProperty('outcome')
    reportCliError(caught, json, { commandPath: ['harness', 'complete'] })
    return { log, error, exitCode: cliErrorExitCode(caught, ['harness', 'complete']) }
  }

  it('prints a rejected outcome with its labels and the retry command, exiting nonzero', async () => {
    const { error, exitCode } = await rejectedComplete(false)
    expect(String(error.mock.calls[0]?.[0])).toContain(rejection)
    expect(exitCode).toBe(1)
  })

  it('returns the rejection in the --json failure envelope, exiting nonzero', async () => {
    const { log, exitCode } = await rejectedComplete(true)
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { message: rejection }
    })
    expect(exitCode).toBe(1)
  })
})
