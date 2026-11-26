import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { AVENAPM_HANDLERS } from './avenapm'

function client(tasks: unknown[]): { client: RuntimeClient; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({
    id: 'req-1',
    ok: true,
    result: { queueName: 'Operación', tasks },
    _meta: { runtimeId: 'runtime-1' }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only uses call and isRemote.
  return { client: { call, isRemote: false } as unknown as RuntimeClient, call }
}

function run(runtime: RuntimeClient, flags: [string, string | boolean][]): Promise<void> {
  return AVENAPM_HANDLERS['avenapm queue']({
    flags: new Map(flags),
    client: runtime,
    cwd: '/tmp',
    json: false
  })
}

describe('avenapm queue', () => {
  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('fails a precheck when no ticket matches', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client: runtime, call } = client([])
    await run(runtime, [
      ['status', 'por_hacer'],
      ['unassigned', true],
      ['require-any', true]
    ])
    expect(call).toHaveBeenCalledWith('avenapm.queue', { status: 'por_hacer', unassigned: true })
    expect(process.exitCode).toBe(1)
  })

  it('passes a precheck when a ticket is waiting', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client: runtime } = client([
      { id: 'x', shortId: 'OP-7', status: 'por_hacer', assignee: null, title: 'Arreglar' }
    ])
    await run(runtime, [['require-any', true]])
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects an unknown status before calling Topo', async () => {
    const { client: runtime, call } = client([])
    await expect(run(runtime, [['status', 'hecho']])).rejects.toThrow(/--status must be one of/)
    expect(call).not.toHaveBeenCalled()
  })
})
