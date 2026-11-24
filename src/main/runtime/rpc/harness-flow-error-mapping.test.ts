import { describe, expect, it } from 'vitest'
import { HarnessFlowError } from '../../../shared/harness/harness-flow-errors'
import { mapRuntimeError } from './errors'

const meta = { runtimeId: 'runtime-1' }

describe('harness flow errors over RPC', () => {
  it('keeps the conflict code so an agent can re-read and retry', () => {
    const reply = mapRuntimeError(
      'req-1',
      meta,
      new HarnessFlowError('harness_flow_conflict', 'flow f changed since 1')
    )
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe('harness_flow_conflict')
    expect(reply.error.message).toBe('harness_flow_conflict: flow f changed since 1')
  })

  it('keeps the scope refusal code', () => {
    const reply = mapRuntimeError(
      'req-1',
      meta,
      new HarnessFlowError('harness_flow_scope_forbidden', 'f belongs to another repo')
    )
    expect(reply.error.code).toBe('harness_flow_scope_forbidden')
  })
})
