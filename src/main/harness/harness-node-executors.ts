import { outcomeChoices } from '../../shared/harness/harness-agent-prompt'
import type {
  HarnessAgentNode,
  HarnessEndNode,
  HarnessHumanNode,
  HarnessNode,
  HarnessStartNode
} from '../../shared/harness/harness-flow-types'
import { CONTINUE, STOP, type HarnessStepRuntime } from './harness-step-runtime'

export type HarnessRoute = { outcome: string | null } | { goto: string }

export function redirectOnLimit(
  rt: HarnessStepRuntime,
  node: HarnessNode & { maxVisits: number },
  target: string
): HarnessRoute {
  const targetTitle = rt.run.flow.nodes.find((entry) => entry.id === target)?.title ?? target
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: 'running'
  })
  rt.finishStep(step, {
    status: 'done',
    output: `Llegó al límite de ${node.maxVisits} visitas; sigue en «${targetTitle}».`
  })
  return { goto: target }
}

/** A chat answers a restart in free text; without explicit fields that text is the first required one. */
function restartFields(
  node: HarnessStartNode,
  answer: { text: string; fields: Record<string, string> }
): Record<string, string> {
  if (Object.keys(answer.fields).length > 0 || !answer.text.trim()) {
    return answer.fields
  }
  const first = node.fields.find((field) => !field.optional) ?? node.fields[0]
  return first ? { [first.key]: answer.text.trim() } : {}
}

export async function executeStartNode(
  rt: HarnessStepRuntime,
  node: HarnessStartNode,
  visit: number
): Promise<string | null> {
  const { run } = rt
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: visit === 1 ? 'running' : 'waiting'
  })
  if (visit > 1) {
    const answer = await rt.ask(step, {
      title: node.title,
      reason: 'restart',
      prompt: 'La intención cambió. Registra el nuevo Intent; el anterior queda en el historial.',
      context: node.fields.map((field) => ({ key: field.key, value: run.vars[field.key] ?? '' })),
      choices: [],
      fields: node.fields
    })
    const fields = restartFields(node, answer)
    for (const field of node.fields) {
      const previous = run.vars[field.key]
      if (previous) {
        rt.writeVar(`${field.key}_anterior`, previous)
      }
      rt.writeVar(field.key, fields[field.key] ?? previous ?? '')
    }
  }
  rt.finishStep(step, {
    status: 'done',
    output: node.fields.map((field) => `${field.label}: ${run.vars[field.key] ?? ''}`).join('\n')
  })
  return null
}

export async function executeHumanNode(
  rt: HarnessStepRuntime,
  node: HarnessHumanNode
): Promise<string | null> {
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: 'waiting'
  })
  const answer = await rt.ask(step, {
    title: node.title,
    reason: 'human',
    prompt: node.prompt,
    context: rt.inputContext(node),
    choices: outcomeChoices(rt.run.flow, node.id, rt.run.vars),
    fields: []
  })
  const output = [answer.choice ? `Decisión: ${answer.choice}` : '', answer.text]
    .filter(Boolean)
    .join('\n\n')
  rt.writeVar(node.outputKey, output)
  rt.finishStep(step, { status: 'done', output, outcome: answer.choice })
  return answer.choice
}

export async function executeAgentNode(
  rt: HarnessStepRuntime,
  node: HarnessAgentNode
): Promise<string | null> {
  const choices = outcomeChoices(rt.run.flow, node.id, rt.run.vars)
  const result = await rt.runAgentStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    block: node.block,
    agent: node.agent,
    instructions: node.prompt,
    context: rt.inputContext(node),
    choices,
    sessionKey: node.reuseSession ? node.id : null,
    runner: node.runner,
    allowEdits: node.allowEdits
  })
  if (result === null) {
    // A skipped step that only leaves through labeled edges would silently end the run.
    return choices.length > 0 ? askOutcomeAfterSkip(rt, node, choices) : null
  }
  rt.writeVar(node.outputKey, result.output)
  if (choices.length === 0 || result.outcome) {
    return result.outcome
  }
  const answer = await rt.ask(result.step, {
    title: node.title,
    reason: 'outcome',
    prompt: 'El agente no eligió una salida. Elige cómo sigue el flujo.',
    context: [{ key: node.outputKey, value: result.output }],
    choices,
    fields: []
  })
  result.step.outcome = answer.choice
  rt.touch()
  return answer.choice
}

async function askOutcomeAfterSkip(
  rt: HarnessStepRuntime,
  node: HarnessAgentNode,
  choices: string[]
): Promise<string | null> {
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: 'waiting'
  })
  const answer = await rt.ask(step, {
    title: node.title,
    reason: 'outcome',
    prompt: 'Se omitió este paso. Elige cómo sigue el flujo.',
    context: [],
    choices,
    fields: []
  })
  rt.finishStep(step, { status: 'done', outcome: answer.choice })
  return answer.choice
}

/** Loops past `maxVisits` continue only when a person says so. */
export async function confirmExtraVisit(
  rt: HarnessStepRuntime,
  node: HarnessNode & { maxVisits: number }
): Promise<void> {
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: 'waiting'
  })
  const answer = await rt.ask(step, {
    title: node.title,
    reason: 'visit-limit',
    prompt: `«${node.title}» ya corrió ${node.maxVisits} veces. ¿Seguimos una vez más?`,
    context: [],
    choices: [CONTINUE, STOP],
    fields: []
  })
  rt.finishStep(step, { status: 'done', outcome: answer.choice })
  if (answer.choice === STOP) {
    rt.stopRun()
  }
}

export function executeEndNode(rt: HarnessStepRuntime, node: HarnessEndNode): null {
  const step = rt.addStep({
    nodeId: node.id,
    taskId: null,
    title: node.title,
    agent: null,
    status: 'running'
  })
  rt.finishStep(step, { status: 'done' })
  return null
}
