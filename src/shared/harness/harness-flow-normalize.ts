import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import { TUI_AGENT_DISPLAY_NAMES } from '../agent-launch/catalog/tui-agent-display-names'
import { asRecord } from '../workspace-setup/setup-script-import-parsers'
import {
  HARNESS_FLOW_SCHEMA_VERSION,
  type HarnessEdge,
  type HarnessEdgeCondition,
  type HarnessFlow,
  type HarnessFlowScope,
  type HarnessNode,
  type HarnessPosition,
  type HarnessProjectProfile,
  type HarnessStartField,
  type HarnessWaveRole
} from './harness-flow-types'

const MAX_NODES = 200
const MAX_EDGES = 600
const MAX_TEXT = 64 * 1024
const MAX_SHORT = 200
const MAX_VISITS_CAP = 50

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function key(value: unknown): string {
  return text(value, MAX_SHORT)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
}

function keysOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, MAX_SHORT).trim())
        .filter(Boolean)
        .slice(0, 30)
    : []
}

export const EMPTY_HARNESS_PROJECT: HarnessProjectProfile = {
  appCommand: '',
  appUrl: '',
  testCommand: '',
  evidenceTool: '',
  notes: '',
  prMode: 'single'
}

function project(value: unknown): HarnessProjectProfile {
  const record = asRecord(value)
  return {
    appCommand: text(record?.appCommand, 2000),
    appUrl: text(record?.appUrl, 2000),
    testCommand: text(record?.testCommand, 2000),
    evidenceTool: text(record?.evidenceTool, 8000),
    notes: text(record?.notes),
    prMode: record?.prMode === 'stacked' ? 'stacked' : 'single'
  }
}

function keys(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(key).filter(Boolean))].slice(0, 50) : []
}

export function isTuiAgent(value: unknown): value is TuiAgent {
  return typeof value === 'string' && Object.hasOwn(TUI_AGENT_DISPLAY_NAMES, value)
}

function agentOrNull(value: unknown): TuiAgent | null {
  return isTuiAgent(value) ? value : null
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function position(value: unknown): HarnessPosition {
  const record = asRecord(value)
  return { x: finite(record?.x, 0), y: finite(record?.y, 0) }
}

function maxVisits(value: unknown): number {
  return Math.min(MAX_VISITS_CAP, Math.max(1, Math.round(finite(value, 5))))
}

function startFields(value: unknown): HarnessStartField[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, 20).flatMap((raw) => {
    const record = asRecord(raw)
    const fieldKey = key(record?.key)
    if (!fieldKey) {
      return []
    }
    const options = Array.isArray(record?.options)
      ? record.options.map((option) => text(option, MAX_SHORT).trim()).filter(Boolean)
      : []
    return [
      {
        key: fieldKey,
        label: text(record?.label, MAX_SHORT) || fieldKey,
        options,
        optional: record?.optional === true
      }
    ]
  })
}

function waveRoles(value: unknown): HarnessWaveRole[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, 20).flatMap((raw) => {
    const record = asRecord(raw)
    const name = text(record?.name, MAX_SHORT).trim()
    return name
      ? [
          {
            name,
            agent: agentOrNull(record?.agent),
            prompt: text(record?.prompt),
            paths: keysOf(record?.paths)
          }
        ]
      : []
  })
}

function node(raw: unknown): HarnessNode | null {
  const record = asRecord(raw)
  const id = key(record?.id)
  if (!record || !id) {
    return null
  }
  const base = {
    id,
    title: text(record.title, MAX_SHORT) || id,
    block: text(record.block, MAX_SHORT),
    position: position(record.position)
  }
  const flowStep = {
    inputs: keys(record.inputs),
    outputKey: key(record.outputKey) || id,
    joinAll: record.joinAll === true,
    maxVisits: maxVisits(record.maxVisits),
    limitTarget: key(record.limitTarget) || null
  }
  switch (record.kind) {
    case 'start':
      return { ...base, kind: 'start', fields: startFields(record.fields) }
    case 'agent':
      return {
        ...base,
        ...flowStep,
        kind: 'agent',
        agent: agentOrNull(record.agent),
        prompt: text(record.prompt),
        reuseSession: record.reuseSession !== false
      }
    case 'human':
      return { ...base, ...flowStep, kind: 'human', prompt: text(record.prompt) }
    case 'waves':
      return {
        ...base,
        ...flowStep,
        kind: 'waves',
        planKey: key(record.planKey),
        roles: waveRoles(record.roles),
        verifyCommand: text(record.verifyCommand, 2000),
        checkpointEachWave: record.checkpointEachWave === true
      }
    case 'end':
      return { ...base, kind: 'end' }
    default:
      return null
  }
}

function condition(value: unknown): HarnessEdgeCondition | null {
  const record = asRecord(value)
  const conditionKey = key(record?.key)
  if (!conditionKey) {
    return null
  }
  return {
    key: conditionKey,
    op: record?.op === 'neq' ? 'neq' : 'eq',
    value: text(record?.value, MAX_SHORT).trim()
  }
}

function scope(value: unknown): HarnessFlowScope {
  const record = asRecord(value)
  const repoId = text(record?.repoId, MAX_SHORT)
  return record?.kind === 'repo' && repoId ? { kind: 'repo', repoId } : { kind: 'global' }
}

/** Untrusted input (IPC, disk) becomes a bounded flow; edges to unknown nodes are dropped. */
export function normalizeHarnessFlow(raw: unknown): HarnessFlow | null {
  const record = asRecord(raw)
  const id = key(record?.id)
  if (!record || !id) {
    return null
  }
  const nodes: HarnessNode[] = []
  const seen = new Set<string>()
  for (const candidate of Array.isArray(record.nodes) ? record.nodes.slice(0, MAX_NODES) : []) {
    const parsed = node(candidate)
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id)
      nodes.push(parsed)
    }
  }
  for (const parsed of nodes) {
    if ('limitTarget' in parsed && parsed.limitTarget && !seen.has(parsed.limitTarget)) {
      parsed.limitTarget = null
    }
  }
  const edges: HarnessEdge[] = []
  const edgeIds = new Set<string>()
  for (const candidate of Array.isArray(record.edges) ? record.edges.slice(0, MAX_EDGES) : []) {
    const edge = asRecord(candidate)
    const edgeId = key(edge?.id)
    const source = key(edge?.source)
    const target = key(edge?.target)
    if (edgeId && !edgeIds.has(edgeId) && seen.has(source) && seen.has(target)) {
      edgeIds.add(edgeId)
      edges.push({
        id: edgeId,
        source,
        target,
        label: text(edge?.label, MAX_SHORT).trim(),
        when: condition(edge?.when)
      })
    }
  }
  return {
    schemaVersion: HARNESS_FLOW_SCHEMA_VERSION,
    id,
    name: text(record.name, MAX_SHORT).trim() || 'Flow',
    description: text(record.description, 2000),
    scope: scope(record.scope),
    basedOnFlowId: key(record.basedOnFlowId) || null,
    defaultAgent: agentOrNull(record.defaultAgent) ?? 'claude',
    sharedInstructions: text(record.sharedInstructions),
    project: project(record.project),
    nodes,
    edges,
    updatedAt: finite(record.updatedAt, 0)
  }
}
