import { describe, expect, it } from 'vitest'
import type { HarnessChatTask } from './harness-run-types'
import {
  harnessSubagentPrompt,
  matchSubagentPrompt,
  resolveChatRunner
} from './harness-subagent-contract'
import { IDEATION_NODES } from './harness-example-flow-ideation'

function task(id: string, instructions: string): HarnessChatTask {
  return {
    id,
    stepId: `${id}-step`,
    nodeId: id,
    taskId: null,
    title: id,
    instructions,
    choices: [],
    allowEdits: false,
    delivery: 'subagent',
    subagent: { label: id, prompt: harnessSubagentPrompt(id, instructions) },
    createdAt: 0
  }
}

describe('resolveChatRunner', () => {
  it('keeps chat and topo runners as they are', () => {
    expect(resolveChatRunner({ runner: 'chat', agent: null }, 'codex')).toBe('chat')
    expect(resolveChatRunner({ runner: 'topo', agent: null }, 'claude')).toBe('topo')
  })

  it('runs subagent steps as subagents only when the chat can host them', () => {
    expect(resolveChatRunner({ runner: 'subagent', agent: null }, 'claude')).toBe('subagent')
    expect(resolveChatRunner({ runner: 'subagent', agent: 'claude' }, 'claude')).toBe('subagent')
    expect(resolveChatRunner({ runner: 'subagent', agent: null }, 'codex')).toBe('topo')
    expect(resolveChatRunner({ runner: 'subagent', agent: null }, null)).toBe('topo')
    expect(resolveChatRunner({ runner: 'subagent', agent: 'codex' }, 'claude')).toBe('topo')
  })
})

describe('harnessSubagentPrompt / matchSubagentPrompt', () => {
  const tasks = (): HarnessChatTask[] => [
    task('t1', 'Critica la idea.\n\n- punto'),
    task('t2', 'Otra tarea')
  ]

  it('marks the prompt with the task id on its first line', () => {
    const prompt = harnessSubagentPrompt('t1', 'Critica la idea.')
    expect(prompt.split('\n')[0]).toBe('[topo-harness-task:t1]')
    expect(prompt).toContain('Critica la idea.')
  })

  it('matches the exact prompt, tolerating only whitespace differences', () => {
    expect(matchSubagentPrompt(tasks()[0]!.subagent!.prompt, tasks())).toEqual({ task: tasks()[0] })
    const reflowed = `  ${tasks()[0]!.subagent!.prompt.replace('\n\n', '\n')}\n`
    expect(matchSubagentPrompt(reflowed, tasks())).toEqual({ task: tasks()[0] })
  })

  it('rejects prompts without marker, for unknown tasks or with changed wording', () => {
    expect(matchSubagentPrompt('Critica la idea.', tasks())).toEqual({ error: 'no_marker' })
    expect(matchSubagentPrompt(harnessSubagentPrompt('zz', 'x'), tasks())).toEqual({
      error: 'unknown_task'
    })
    expect(
      matchSubagentPrompt(`${tasks()[1]!.subagent!.prompt}\nContexto extra del chat`, tasks())
    ).toEqual({ error: 'prompt_mismatch' })
  })

  it('ignores open tasks the chat does itself', () => {
    const own = { ...tasks()[1]!, delivery: 'self' as const }
    expect(matchSubagentPrompt(tasks()[1]!.subagent!.prompt, [own])).toEqual({
      error: 'unknown_task'
    })
  })
})

describe('example ideation flow', () => {
  it('runs the review table as fresh chat subagents', () => {
    const mesa = IDEATION_NODES.filter(
      (node) => node.kind === 'agent' && node.block.includes('Mesa')
    )
    expect(mesa.length).toBe(3)
    for (const node of mesa) {
      expect(node).toMatchObject({ runner: 'subagent', reuseSession: false })
    }
  })
})
