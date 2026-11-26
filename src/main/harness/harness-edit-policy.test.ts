import { describe, expect, it } from 'vitest'
import { createHarnessExampleFlow } from '../../shared/harness/harness-example-flow'
import type {
  HarnessChatTask,
  HarnessRun,
  HarnessRunStep
} from '../../shared/harness/harness-run-types'
import { harnessRunAllowsEdits } from './harness-edit-policy'

function step(status: HarnessRunStep['status'], allowEdits?: boolean): HarnessRunStep {
  return {
    id: `s-${status}-${String(allowEdits)}`,
    nodeId: 'n',
    taskId: null,
    title: 'Paso',
    visit: 1,
    status,
    agent: 'claude',
    session: null,
    output: '',
    outcome: null,
    error: null,
    startedAt: 0,
    endedAt: null,
    ...(allowEdits === undefined ? {} : { allowEdits })
  }
}

function task(allowEdits: boolean): HarnessChatTask {
  return {
    id: 't',
    stepId: 's',
    nodeId: 'n',
    taskId: null,
    title: 'Tarea',
    instructions: '',
    choices: [],
    allowEdits,
    createdAt: 0
  }
}

function run(
  mode: HarnessRun['mode'],
  steps: HarnessRunStep[],
  chatTasks: HarnessChatTask[] = []
): HarnessRun {
  const flow = createHarnessExampleFlow(0)
  return {
    id: 'run',
    mode,
    chatSessionId: null,
    chatTasks,
    flowId: flow.id,
    flowName: flow.name,
    flow,
    worktreeId: 'wt',
    status: 'running',
    vars: {},
    steps,
    pending: [],
    error: null,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('harnessRunAllowsEdits', () => {
  it('blocks edits while an orchestrated run only runs read-only steps', () => {
    expect(harnessRunAllowsEdits(run('orchestrated', [step('running', false)]))).toBe(false)
    expect(
      harnessRunAllowsEdits(run('orchestrated', [step('running', false), step('running', true)]))
    ).toBe(true)
  })

  it('leaves an orchestrated run that runs nothing unrestricted', () => {
    expect(harnessRunAllowsEdits(run('orchestrated', [step('done', false)]))).toBe(true)
  })

  it('lets a chat-driven run edit through a Topo step that allows it, not only its chat tasks', () => {
    expect(harnessRunAllowsEdits(run('chat', [step('running', true)]))).toBe(true)
    expect(harnessRunAllowsEdits(run('chat', [step('running', false)]))).toBe(false)
    expect(harnessRunAllowsEdits(run('chat', [], [task(true)]))).toBe(true)
  })

  it('keeps a chat-driven run read-only between tasks, ignoring steps saved before the field', () => {
    expect(harnessRunAllowsEdits(run('chat', [step('running')]))).toBe(false)
    expect(harnessRunAllowsEdits(run('chat', [], [task(false)]))).toBe(false)
  })
})
