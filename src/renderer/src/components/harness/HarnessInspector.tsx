import React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import type {
  HarnessEdge,
  HarnessEdgeCondition,
  HarnessFlow
} from '../../../../shared/harness/harness-flow-types'
import type { HarnessCanvasSelection } from './HarnessFlowCanvas'
import { HarnessNodeInspector } from './HarnessNodeInspector'
import { HarnessProjectFields } from './HarnessProjectFields'
import { AgentSelect, InspectorField, InspectorSwitch } from './harness-inspector-fields'
import { harnessFlowVariables } from './harness-flow-editing'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const WAIT_FOR_PERSON = '__wait__'

function EdgeConditionFields({
  when,
  variables,
  onChange
}: {
  when: HarnessEdgeCondition
  variables: string[]
  onChange: (when: HarnessEdgeCondition) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex items-center gap-1.5">
      <Select value={when.key} onValueChange={(key) => onChange({ ...when, key })}>
        <SelectTrigger
          size="sm"
          className="min-w-0 flex-1"
          aria-label={t('components.harness.inspector.edgeWhenKey', 'Variable')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variables.map((variable) => (
            <SelectItem key={variable} value={variable}>
              {variable}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={when.op}
        onValueChange={(op) => onChange({ ...when, op: op === 'neq' ? 'neq' : 'eq' })}
      >
        <SelectTrigger
          size="sm"
          className="w-16"
          aria-label={t('components.harness.inspector.edgeWhenOp', 'Comparison')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eq">=</SelectItem>
          <SelectItem value="neq">≠</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={when.value}
        className="min-w-0 flex-1"
        aria-label={t('components.harness.inspector.edgeWhenValue', 'Value')}
        onChange={(event) => onChange({ ...when, value: event.target.value })}
      />
    </div>
  )
}

function EdgeInspector({
  edge,
  flow,
  onChange,
  onDelete
}: {
  edge: HarnessEdge
  flow: HarnessFlow
  onChange: (edge: HarnessEdge) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const title = (nodeId: string): string =>
    flow.nodes.find((node) => node.id === nodeId)?.title ?? nodeId
  const variables = harnessFlowVariables(flow)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {title(edge.source)} → {title(edge.target)}
      </p>
      <InspectorField
        label={t('components.harness.inspector.edgeLabel', 'Condition')}
        hint={t(
          'components.harness.inspector.edgeLabelHint',
          'Empty: always followed (several empty connections run in parallel). With text: an outcome the agent or you choose.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            value={edge.label}
            onChange={(event) => onChange({ ...edge, label: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorSwitch
        label={t('components.harness.inspector.edgeWhen', 'Only when a variable matches')}
        hint={t(
          'components.harness.inspector.edgeWhenHint',
          'For example tipo = bug, so a step runs only for bugs.'
        )}
        checked={edge.when !== null}
        onChange={(enabled) =>
          onChange({
            ...edge,
            when: enabled ? { key: variables[0] ?? '', op: 'eq', value: '' } : null
          })
        }
      />
      {edge.when ? (
        <EdgeConditionFields
          when={edge.when}
          variables={variables}
          onChange={(when) => onChange({ ...edge, when })}
        />
      ) : null}
      <Button variant="outline" size="sm" className="self-start" onClick={onDelete}>
        <Trash2 />
        {t('components.harness.inspector.deleteEdge', 'Delete connection')}
      </Button>
    </div>
  )
}

function FlowInspector({
  flow,
  onChange
}: {
  flow: HarnessFlow
  onChange: (flow: HarnessFlow) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <InspectorField label={t('components.harness.inspector.flowName', 'Flow name')}>
        {(id) => (
          <Input
            id={id}
            value={flow.name}
            onChange={(event) => onChange({ ...flow, name: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.inspector.flowDescription', 'Description')}>
        {(id) => (
          <Textarea
            id={id}
            value={flow.description}
            rows={3}
            onChange={(event) => onChange({ ...flow, description: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.inspector.defaultAgent', 'Default agent')}>
        {(id) => (
          <AgentSelect
            id={id}
            value={flow.defaultAgent}
            flowDefault={null}
            onChange={(agent) => agent && onChange({ ...flow, defaultAgent: agent })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.inspector.escalationNode', 'When nobody is watching')}
        hint={t(
          'components.harness.inspector.escalationNodeHint',
          'Failures, missing outcomes and loop limits go to this node instead of waiting for you. Human nodes still ask.'
        )}
      >
        {(id) => (
          <Select
            value={flow.escalationNode ?? WAIT_FOR_PERSON}
            onValueChange={(value) =>
              onChange({ ...flow, escalationNode: value === WAIT_FOR_PERSON ? null : value })
            }
          >
            <SelectTrigger id={id} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WAIT_FOR_PERSON}>
                {t('components.harness.inspector.escalationWait', 'Wait for me')}
              </SelectItem>
              {flow.nodes
                .filter((node) => node.kind === 'agent')
                .map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.inspector.shared', 'Rules for every agent')}
        hint={t(
          'components.harness.inspector.sharedHint',
          'Topo adds them to each agent it launches. The repo’s CLAUDE.md and AGENTS.md stay untouched.'
        )}
      >
        {(id) => (
          <Textarea
            id={id}
            value={flow.sharedInstructions}
            rows={10}
            onChange={(event) => onChange({ ...flow, sharedInstructions: event.target.value })}
          />
        )}
      </InspectorField>
      <HarnessProjectFields flow={flow} onChange={onChange} />
    </div>
  )
}

export function HarnessInspector({
  flow,
  selection,
  onFlowChange,
  onSelect
}: {
  flow: HarnessFlow
  selection: HarnessCanvasSelection
  onFlowChange: (flow: HarnessFlow) => void
  onSelect: (selection: HarnessCanvasSelection) => void
}): React.JSX.Element {
  const node =
    selection?.kind === 'node' ? flow.nodes.find((entry) => entry.id === selection.id) : null
  const edge =
    selection?.kind === 'edge' ? flow.edges.find((entry) => entry.id === selection.id) : null
  if (node) {
    return (
      <HarnessNodeInspector
        key={node.id}
        flow={flow}
        node={node}
        onChange={(next) =>
          onFlowChange({
            ...flow,
            nodes: flow.nodes.map((entry) => (entry.id === node.id ? next : entry))
          })
        }
        onDelete={() => {
          onFlowChange({
            ...flow,
            nodes: flow.nodes.filter((entry) => entry.id !== node.id),
            edges: flow.edges.filter(
              (entry) => entry.source !== node.id && entry.target !== node.id
            )
          })
          onSelect(null)
        }}
      />
    )
  }
  if (edge) {
    return (
      <EdgeInspector
        key={edge.id}
        edge={edge}
        flow={flow}
        onChange={(next) =>
          onFlowChange({
            ...flow,
            edges: flow.edges.map((entry) => (entry.id === edge.id ? next : entry))
          })
        }
        onDelete={() => {
          onFlowChange({ ...flow, edges: flow.edges.filter((entry) => entry.id !== edge.id) })
          onSelect(null)
        }}
      />
    )
  }
  return <FlowInspector flow={flow} onChange={onFlowChange} />
}
