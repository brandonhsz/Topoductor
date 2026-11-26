import React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import type {
  HarnessAgentNode,
  HarnessFlow,
  HarnessHumanNode,
  HarnessNode,
  HarnessNodeRunner,
  HarnessWavesNode
} from '../../../../shared/harness/harness-flow-types'
import { StartFieldsEditor, WaveRolesEditor } from './HarnessListEditors'
import { AgentSelect, InspectorField, InspectorSwitch, ListInput } from './harness-inspector-fields'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { harnessFlowVariables } from './harness-flow-editing'

type StepNode = HarnessAgentNode | HarnessHumanNode | HarnessWavesNode

const ASK_ME = '__ask__'

function FlowStepFields<N extends StepNode>({
  node,
  nodes,
  variables,
  onChange
}: {
  node: N
  nodes: readonly HarnessNode[]
  variables: string[]
  onChange: (node: N) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <InspectorField
        label={t('components.harness.inspector.inputs', 'Receives')}
        hint={t(
          'components.harness.inspector.inputsHint',
          'Variables passed as context, separated by commas. Available: {{vars}}',
          { vars: variables.join(', ') || '—' }
        )}
      >
        {(id) => (
          <ListInput
            id={id}
            values={node.inputs}
            onChange={(inputs) => onChange({ ...node, inputs })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.inspector.freshInputs', 'Only when new')}
        hint={t(
          'components.harness.inspector.freshInputsHint',
          'Received variables passed again only after they change, so a loop never re-sends findings it already handled.'
        )}
      >
        {(id) => (
          <ListInput
            id={id}
            values={node.freshInputs ?? []}
            onChange={(freshInputs) => onChange({ ...node, freshInputs })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.inspector.output', 'Delivers to variable')}
        hint={t(
          'components.harness.inspector.outputHint',
          'Later nodes receive this node’s final answer under this name.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={node.outputKey}
            onChange={(event) => onChange({ ...node, outputKey: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorSwitch
        label={t('components.harness.inspector.joinAll', 'Wait for every previous node')}
        hint={t(
          'components.harness.inspector.joinAllHint',
          'Use it after parallel agents, like a round synthesis.'
        )}
        checked={node.joinAll}
        onChange={(joinAll) => onChange({ ...node, joinAll })}
      />
      <InspectorField
        label={t('components.harness.inspector.maxVisits', 'Maximum visits per run')}
        hint={t(
          'components.harness.inspector.maxVisitsHint',
          'When a loop exceeds it, Topo goes to the node below, or asks you.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={50}
            value={node.maxVisits}
            onChange={(event) =>
              onChange({ ...node, maxVisits: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.inspector.limitTarget', 'At the limit, go to')}>
        {(id) => (
          <Select
            value={node.limitTarget ?? ASK_ME}
            onValueChange={(value) =>
              onChange({ ...node, limitTarget: value === ASK_ME ? null : value })
            }
          >
            <SelectTrigger id={id} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ASK_ME}>
                {t('components.harness.inspector.limitAsk', 'Ask me')}
              </SelectItem>
              {nodes
                .filter((candidate) => candidate.id !== node.id)
                .map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </InspectorField>
    </>
  )
}

function WavesFields({
  node,
  flow,
  onChange
}: {
  node: HarnessWavesNode
  flow: HarnessFlow
  onChange: (node: HarnessWavesNode) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <InspectorField
        label={t('components.harness.inspector.planKey', 'Plan variable')}
        hint={t(
          'components.harness.inspector.planKeyHint',
          'Must hold a ```json block with {"tasks":[{"id","role","title","criteria","dependsOn","files","wave"}]}.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={node.planKey}
            onChange={(event) => onChange({ ...node, planKey: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.inspector.verify', 'Verification after each wave')}
        hint={t(
          'components.harness.inspector.verifyHint',
          'Command an agent runs and reports, for example pnpm test. Empty skips it.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={node.verifyCommand}
            onChange={(event) => onChange({ ...node, verifyCommand: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorSwitch
        label={t('components.harness.inspector.checkpoint', 'Commit after each wave')}
        hint={t(
          'components.harness.inspector.checkpointHint',
          'Leaves a git checkpoint to compare or roll back. Skipped outside git repositories.'
        )}
        checked={node.checkpointEachWave}
        onChange={(checkpointEachWave) => onChange({ ...node, checkpointEachWave })}
      />
      <WaveRolesEditor
        roles={node.roles}
        flowDefault={flow.defaultAgent}
        onChange={(roles) => onChange({ ...node, roles })}
      />
    </>
  )
}

function toNodeRunner(value: string, allowSubagent: boolean): HarnessNodeRunner {
  if (value === 'topo') {
    return 'topo'
  }
  return value === 'subagent' && allowSubagent ? 'subagent' : 'chat'
}

function RunnerFields<N extends HarnessAgentNode | HarnessWavesNode>({
  node,
  onChange
}: {
  node: N
  onChange: (node: N) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <InspectorField
        label={t('components.harness.inspector.runner', 'Who runs it')}
        hint={t(
          'components.harness.inspector.runnerHint',
          'The workspace chat follows the flow. Subagents run a step in fresh context without a new tab. Choose Topo for steps that need other models, like a review table.'
        )}
      >
        {(id) => (
          <Select
            value={node.runner}
            onValueChange={(runner) =>
              onChange({ ...node, runner: toNodeRunner(runner, node.kind === 'agent') })
            }
          >
            <SelectTrigger id={id} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">
                {t('components.harness.inspector.runnerChat', 'The workspace chat')}
              </SelectItem>
              <SelectItem value="topo">
                {t('components.harness.inspector.runnerTopo', 'Topo, with its own agent')}
              </SelectItem>
              {node.kind === 'agent' ? (
                <SelectItem value="subagent">
                  {t(
                    'components.harness.inspector.runnerSubagent',
                    'Subagents of the workspace chat'
                  )}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        )}
      </InspectorField>
      <InspectorSwitch
        label={t('components.harness.inspector.allowEdits', 'Allow editing files')}
        hint={t(
          'components.harness.inspector.allowEditsHint',
          'Off blocks file edits while the chat is on this step (Claude), like ideation before the plan is approved.'
        )}
        checked={node.allowEdits}
        onChange={(allowEdits) => onChange({ ...node, allowEdits })}
      />
    </>
  )
}

export function HarnessNodeInspector({
  flow,
  node,
  onChange,
  onDelete
}: {
  flow: HarnessFlow
  node: HarnessNode
  onChange: (node: HarnessNode) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const variables = harnessFlowVariables(flow)
  return (
    <div className="flex flex-col gap-4">
      <InspectorField label={t('components.harness.inspector.title', 'Name')}>
        {(id) => (
          <Input
            id={id}
            value={node.title}
            onChange={(event) => onChange({ ...node, title: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.inspector.block', 'Stage')}>
        {(id) => (
          <Input
            id={id}
            value={node.block}
            placeholder={t(
              'components.harness.inspector.blockPlaceholder',
              'For example, Bloque 1'
            )}
            onChange={(event) => onChange({ ...node, block: event.target.value })}
          />
        )}
      </InspectorField>
      {node.kind === 'start' ? (
        <StartFieldsEditor
          fields={node.fields}
          onChange={(fields) => onChange({ ...node, fields })}
        />
      ) : null}
      {node.kind === 'agent' || node.kind === 'waves' ? (
        <RunnerFields node={node} onChange={onChange} />
      ) : null}
      {node.kind === 'agent' ? (
        <InspectorField label={t('components.harness.inspector.agent', 'Agent')}>
          {(id) => (
            <AgentSelect
              id={id}
              value={node.agent}
              flowDefault={flow.defaultAgent}
              onChange={(agent) => onChange({ ...node, agent })}
            />
          )}
        </InspectorField>
      ) : null}
      {node.kind === 'agent' ? (
        <InspectorSwitch
          label={t(
            'components.harness.inspector.reuseSession',
            'Continue the same chat each round'
          )}
          hint={t(
            'components.harness.inspector.reuseSessionHint',
            'The agent keeps what it read before. Turn it off for a fresh look every round.'
          )}
          checked={node.reuseSession}
          onChange={(reuseSession) => onChange({ ...node, reuseSession })}
        />
      ) : null}
      {node.kind === 'agent' || node.kind === 'human' ? (
        <InspectorField
          label={
            node.kind === 'agent'
              ? t('components.harness.inspector.prompt', 'Prompt')
              : t('components.harness.inspector.humanPrompt', 'What to ask you')
          }
        >
          {(id) => (
            <Textarea
              id={id}
              value={node.prompt}
              rows={12}
              onChange={(event) => onChange({ ...node, prompt: event.target.value })}
            />
          )}
        </InspectorField>
      ) : null}
      {node.kind === 'waves' ? <WavesFields node={node} flow={flow} onChange={onChange} /> : null}
      {node.kind === 'agent' || node.kind === 'human' || node.kind === 'waves' ? (
        <FlowStepFields node={node} nodes={flow.nodes} variables={variables} onChange={onChange} />
      ) : null}
      <Button variant="outline" size="sm" className="self-start" onClick={onDelete}>
        <Trash2 />
        {t('components.harness.inspector.deleteNode', 'Delete node')}
      </Button>
    </div>
  )
}
