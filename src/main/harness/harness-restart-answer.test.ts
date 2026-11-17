import { describe, expect, it } from 'vitest'
import { EMPTY_HARNESS_PROJECT } from '../../shared/harness/harness-flow-normalize'
import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import type { HarnessRun } from '../../shared/harness/harness-run-types'
import {
  formatHarnessChatStatus,
  harnessChatStatus
} from '../../shared/harness/harness-chat-status'
import { HarnessRunEngine } from './harness-run-engine'

const at = { x: 0, y: 0 }

function restartFlow(): HarnessFlow {
  return {
    schemaVersion: 1,
    id: 'f',
    name: 'Prueba',
    description: '',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: '',
    project: EMPTY_HARNESS_PROJECT,
    nodes: [
      {
        kind: 'start',
        id: 'start',
        title: 'Inicio',
        block: '',
        position: at,
        fields: [
          { key: 'intent', label: 'Intent', options: [], optional: false },
          { key: 'tipo', label: 'Tipo', options: ['feature', 'bug'], optional: false }
        ]
      },
      {
        kind: 'agent',
        id: 'idea',
        title: 'Idea',
        block: '',
        position: at,
        agent: null,
        prompt: 'Describe la idea',
        reuseSession: false,
        runner: 'chat',
        allowEdits: false,
        inputs: ['intent'],
        outputKey: 'idea',
        joinAll: false,
        maxVisits: 5,
        limitTarget: null
      },
      { kind: 'end', id: 'fin', title: 'Fin', block: '', position: at }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'idea', label: '', when: null },
      { id: 'e2', source: 'idea', target: 'start', label: 'La intención cambió', when: null },
      { id: 'e3', source: 'idea', target: 'fin', label: 'Listo', when: null }
    ],
    updatedAt: 0
  }
}

function chatRun(): HarnessRun {
  const flow = restartFlow()
  return {
    id: 'run',
    mode: 'chat',
    chatSessionId: 's1',
    chatTasks: [],
    flowId: flow.id,
    flowName: flow.name,
    flow,
    worktreeId: 'wt',
    status: 'running',
    vars: { intent: 'fangtooth', tipo: 'feature' },
    steps: [],
    pending: [],
    error: null,
    createdAt: 0,
    updatedAt: 0
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

async function reachRestart(): Promise<{ engine: HarnessRunEngine; run: HarnessRun }> {
  const run = chatRun()
  const engine = new HarnessRunEngine(run, {
    launch: () => Promise.reject(new Error('no agents here')),
    onChange: () => {}
  })
  engine.start()
  await settle()
  engine.completeChat({
    taskId: run.chatTasks[0]!.id,
    output: 'Idea v1',
    outcome: 'La intención cambió'
  })
  await settle()
  expect(run.pending.map((decision) => decision.reason)).toEqual(['restart'])
  return { engine, run }
}

describe('restart decisions answered from the chat', () => {
  it('fills the first required start field with the answer text', async () => {
    const { engine, run } = await reachRestart()
    engine.answer({
      decisionId: run.pending[0]!.id,
      choice: null,
      text: 'Una sola pestaña con subagentes',
      fields: {}
    })
    await settle()
    expect(run.vars.intent).toBe('Una sola pestaña con subagentes')
    expect(run.vars.intent_anterior).toBe('fangtooth')
    expect(run.vars.tipo).toBe('feature')
    expect(run.chatTasks[0]!.instructions).toContain('Una sola pestaña con subagentes')
  })

  it('uses explicit fields over the text', async () => {
    const { engine, run } = await reachRestart()
    engine.answer({
      decisionId: run.pending[0]!.id,
      choice: null,
      text: 'ignorado',
      fields: { intent: 'Intent explícito', tipo: 'bug' }
    })
    await settle()
    expect(run.vars.intent).toBe('Intent explícito')
    expect(run.vars.tipo).toBe('bug')
  })

  it('tells the chat how to pass the fields', async () => {
    const { run } = await reachRestart()
    const text = formatHarnessChatStatus(harnessChatStatus(run))
    expect(text).toContain('--field intent=')
  })
})
