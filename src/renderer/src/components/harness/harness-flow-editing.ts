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
        runner: 'chat',
        allowEdits: true,
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
        runner: 'chat',
        allowEdits: true,
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
