import { EMPTY_HARNESS_PROJECT } from '../../../../shared/harness/harness-flow-normalize'
import {
  HARNESS_FLOW_SCHEMA_VERSION,
  type HarnessFlow,
  type HarnessNode,
  type HarnessNodeKind,
  type HarnessPosition
} from '../../../../shared/harness/harness-flow-types'

export function harnessFlowVariables(flow: HarnessFlow): string[] {
  const keys = flow.nodes.flatMap((node) => {
    if (node.kind === 'start') {
      return node.fields.map((field) => field.key)
    }
    return 'outputKey' in node ? [node.outputKey] : []
  })
  return [...new Set(keys.filter(Boolean))]
}

function uniqueId(flow: HarnessFlow, base: string): string {
  const taken = new Set(flow.nodes.map((node) => node.id))
  let id = base
  for (let n = 2; taken.has(id); n++) {
    id = `${base}_${n}`
  }
  return id
}

const STEP_DEFAULTS = { inputs: [], joinAll: false, maxVisits: 5, limitTarget: null }

export function createHarnessNode(
  flow: HarnessFlow,
  kind: HarnessNodeKind,
  position: HarnessPosition,
  title: string
): HarnessNode {
  const id = uniqueId(flow, kind === 'agent' ? 'agente' : kind)
  const base = { id, title, block: '', position }
  switch (kind) {
    case 'start':
      return {
        ...base,
        kind,
        fields: [{ key: 'intent', label: title, options: [], optional: false }]
      }
    case 'agent':
      return {
        ...base,
        ...STEP_DEFAULTS,
        kind,
        agent: null,
        prompt: '',
        reuseSession: true,
        outputKey: id
      }
    case 'human':
      return { ...base, ...STEP_DEFAULTS, kind, prompt: '', outputKey: id }
    case 'waves':
      return {
        ...base,
        ...STEP_DEFAULTS,
        kind,
        planKey: 'plan',
        roles: [],
        verifyCommand: '',
        checkpointEachWave: true,
        outputKey: id
      }
    case 'end':
      return { ...base, kind }
  }
}

function freshId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyHarnessFlow(labels: {
  name: string
  start: string
  intent: string
  end: string
}): HarnessFlow {
  return {
    schemaVersion: HARNESS_FLOW_SCHEMA_VERSION,
    id: freshId('flow'),
    name: labels.name,
    description: '',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: '',
    project: EMPTY_HARNESS_PROJECT,
    nodes: [
      {
        kind: 'start',
        id: 'inicio',
        title: labels.start,
        block: '',
        position: { x: 0, y: 0 },
        fields: [{ key: 'intent', label: labels.intent, options: [], optional: false }]
      },
      { kind: 'end', id: 'fin', title: labels.end, block: '', position: { x: 600, y: 0 } }
    ],
    edges: [],
    updatedAt: 0
  }
}

export function copyHarnessFlowForRepo(flow: HarnessFlow, repoId: string): HarnessFlow {
  return {
    ...flow,
    id: freshId('flow'),
    scope: { kind: 'repo', repoId },
    basedOnFlowId: flow.scope.kind === 'global' ? flow.id : flow.basedOnFlowId
  }
}

export function duplicateHarnessFlow(flow: HarnessFlow, name: string): HarnessFlow {
  return { ...flow, id: freshId('flow'), name, scope: { kind: 'global' }, basedOnFlowId: null }
}

/** Problems that would stall a run, in the order a person should fix them. */
export function harnessFlowProblems(flow: HarnessFlow): string[] {
  const problems: string[] = []
  const starts = flow.nodes.filter((node) => node.kind === 'start')
  if (starts.length !== 1) {
    problems.push('El flujo necesita exactamente un nodo de inicio.')
  }
  const links = [
    ...flow.edges,
    ...flow.nodes.flatMap((node) =>
      'limitTarget' in node && node.limitTarget
        ? [{ source: node.id, target: node.limitTarget }]
        : []
    )
  ]
  const reachable = new Set<string>(starts.map((node) => node.id))
  const queue = [...reachable]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const link of links) {
      if (link.source === current && !reachable.has(link.target)) {
        reachable.add(link.target)
        queue.push(link.target)
      }
    }
  }
  const unreachable = flow.nodes.filter((node) => !reachable.has(node.id))
  if (unreachable.length > 0) {
    problems.push(
      `Nodos sin camino desde el inicio: ${unreachable.map((node) => node.title).join(', ')}.`
    )
  }
  for (const node of flow.nodes) {
    if (node.kind === 'agent' && !node.prompt.trim()) {
      problems.push(`«${node.title}» no tiene prompt.`)
    }
    if (node.kind === 'waves' && node.roles.length === 0) {
      problems.push(`«${node.title}» no tiene roles.`)
    }
  }
  return problems
}
