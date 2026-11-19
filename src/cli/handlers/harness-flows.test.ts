import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { HARNESS_FLOW_HANDLERS } from './harness-flows'

const RESPONSE_META = { id: 'req-1', ok: true, _meta: { runtimeId: 'runtime-1' } }

const READING = {
  flow: { id: 'flow-entrega', name: 'Entrega', updatedAt: 41 },
  markdown: '# Entrega\n\n```mermaid\nflowchart TD\n  plan --> build\n```',
  problems: ['El nodo build no tiene agente'],
  activeRuns: 1,
  affectsAllRepos: true
}

const LIST = [
  {
    id: 'flow-entrega',
    name: 'Entrega',
    description: 'De la intención a la entrega',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    updatedAt: 41,
    nodeCount: 6
  }
]

function flowClient(
  result: unknown,
  isRemote = false
): { client: RuntimeClient; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({ ...RESPONSE_META, result })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only use call and isRemote
  return { client: { call, isRemote } as unknown as RuntimeClient, call }
}

function run(
  command: 'harness flow list' | 'harness flow show' | 'harness flow save',
  client: RuntimeClient,
  flags: Record<string, string> = {},
  json = false
): Promise<void> {
  return HARNESS_FLOW_HANDLERS[command]({
    flags: new Map(Object.entries(flags)),
    client,
    cwd: '/tmp/worktree',
    json
  })
}

function printed(log: ReturnType<typeof vi.spyOn>): string {
  return log.mock.calls.map((args) => String(args[0])).join('\n')
}

describe('harness flow commands', () => {
  let log: ReturnType<typeof vi.spyOn>
  let dir: string

  beforeEach(async () => {
    vi.stubEnv('TOPO_AGENT_SESSION_ID', 'chat-7')
    vi.stubEnv('TOPO_WORKTREE_ID', '')
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    dir = await mkdtemp(join(tmpdir(), 'harness-flow-cli-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  async function flowFile(contents: string): Promise<string> {
    const path = join(dir, 'flow.json')
    await writeFile(path, contents, 'utf8')
    return path
  }

  describe('list', () => {
    it('asks for the flows of the chat session and the named worktree', async () => {
      const { client, call } = flowClient(LIST)

      await run('harness flow list', client, { worktree: 'repo-1::/wt/a' })

      expect(call).toHaveBeenCalledWith('harness.flows.list', {
        sessionId: 'chat-7',
        worktreeId: 'repo-1::/wt/a'
      })
    })

    it('identifies a remote caller only by the worktree from the environment', async () => {
      vi.stubEnv('TOPO_WORKTREE_ID', 'repo-1::/wt/env')
      const { client, call } = flowClient(LIST, true)

      await run('harness flow list', client)

      expect(call).toHaveBeenCalledWith('harness.flows.list', { worktreeId: 'repo-1::/wt/env' })
    })

    it('rejects a caller outside any Topo workspace before calling the runtime', async () => {
      vi.stubEnv('TOPO_AGENT_SESSION_ID', '')
      const { client, call } = flowClient(LIST)

      await expect(run('harness flow list', client)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
      expect(call).not.toHaveBeenCalled()
    })

    it('prints the flow names as text without --json', async () => {
      const { client } = flowClient(LIST)

      await run('harness flow list', client)

      expect(printed(log)).toContain('flow-entrega')
      expect(printed(log)).toContain('Entrega')
      expect(() => JSON.parse(printed(log))).toThrow()
    })

    it('prints the whole response as JSON with --json', async () => {
      const { client } = flowClient(LIST)

      await run('harness flow list', client, {}, true)

      expect(JSON.parse(printed(log))).toMatchObject({ result: LIST })
    })
  })

  describe('show', () => {
    it('reads the requested flow for the caller and prints its markdown', async () => {
      const { client, call } = flowClient(READING)

      await run('harness flow show', client, { flow: 'flow-entrega' })

      expect(call).toHaveBeenCalledWith('harness.flows.get', {
        sessionId: 'chat-7',
        flowId: 'flow-entrega'
      })
      expect(printed(log)).toContain(READING.markdown)
      expect(printed(log)).toContain('El nodo build no tiene agente')
    })

    it('prints the reading as JSON with --json', async () => {
      const { client } = flowClient(READING)

      await run('harness flow show', client, { flow: 'flow-entrega' }, true)

      expect(JSON.parse(printed(log))).toMatchObject({ result: READING })
    })

    it('requires --flow', async () => {
      const { client, call } = flowClient(READING)

      await expect(run('harness flow show', client)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
      expect(call).not.toHaveBeenCalled()
    })
  })

  describe('save', () => {
    const FLOW = { id: 'flow-entrega', name: 'Entrega v2', nodes: [], edges: [] }
    const SAVED = { reading: READING, version: { id: 'v-9', author: 'agent', summary: 'x' } }

    it('sends the flow parsed from the local file with every option', async () => {
      const file = await flowFile(JSON.stringify(FLOW))
      const { client, call } = flowClient(SAVED)

      await run('harness flow save', client, {
        file,
        summary: 'Agrega revisión',
        'expected-updated-at': '41',
        scope: 'repo'
      })

      expect(call).toHaveBeenCalledWith('harness.flows.save', {
        sessionId: 'chat-7',
        flow: FLOW,
        summary: 'Agrega revisión',
        expectedUpdatedAt: 41,
        scope: 'repo'
      })
    })

    it('omits the optional fields that were not passed', async () => {
      const file = await flowFile(JSON.stringify(FLOW))
      const { client, call } = flowClient(SAVED)

      await run('harness flow save', client, { file, summary: 'Crea flujo' })

      expect(call.mock.calls[0][1]).toEqual({
        sessionId: 'chat-7',
        flow: FLOW,
        summary: 'Crea flujo'
      })
    })

    it('prints the save result as JSON with --json', async () => {
      const file = await flowFile(JSON.stringify(FLOW))
      const { client } = flowClient(SAVED)

      await run('harness flow save', client, { file, summary: 'Crea flujo' }, true)

      expect(JSON.parse(printed(log))).toMatchObject({ result: SAVED })
    })

    it.each([
      ['malformed JSON', '{"id": "flow-entrega",'],
      ['a JSON array', '[{"id": "flow-entrega"}]'],
      ['JSON null', 'null']
    ])('rejects %s before calling the runtime', async (_label, contents) => {
      const file = await flowFile(contents)
      const { client, call } = flowClient(SAVED)

      await expect(
        run('harness flow save', client, { file, summary: 'Crea flujo' })
      ).rejects.toMatchObject({ code: 'invalid_argument' })
      expect(call).not.toHaveBeenCalled()
    })

    it('rejects a scope other than global or repo', async () => {
      const file = await flowFile(JSON.stringify(FLOW))
      const { client, call } = flowClient(SAVED)

      await expect(
        run('harness flow save', client, { file, summary: 'Crea flujo', scope: 'workspace' })
      ).rejects.toMatchObject({ code: 'invalid_argument' })
      expect(call).not.toHaveBeenCalled()
    })
  })
})
