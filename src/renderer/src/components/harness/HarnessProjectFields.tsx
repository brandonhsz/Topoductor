import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import type {
  HarnessFlow,
  HarnessProjectProfile
} from '../../../../shared/harness/harness-flow-types'
import { InspectorField, InspectorSwitch } from './harness-inspector-fields'
import { applyTopoPreset } from './harness-project-presets'

/** Repo facts sent to every agent; a repo override fills them so the flow's prompts stay generic. */
export function HarnessProjectFields({
  flow,
  onChange
}: {
  flow: HarnessFlow
  onChange: (flow: HarnessFlow) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { project } = flow
  const set = (patch: Partial<HarnessProjectProfile>): void =>
    onChange({ ...flow, project: { ...project, ...patch } })
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('components.harness.project.title', 'Project data')}
        </span>
        <Button variant="outline" size="xs" onClick={() => onChange(applyTopoPreset(flow))}>
          {t('components.harness.project.topoPreset', 'Use Topo values')}
        </Button>
      </div>
      <p className="text-2xs text-muted-foreground">
        {t(
          'components.harness.project.hint',
          'Every agent receives these. Use “Customize for this repository” so each repo keeps its own.'
        )}
      </p>
      <InspectorField label={t('components.harness.project.appCommand', 'Start the app')}>
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={project.appCommand}
            onChange={(event) => set({ appCommand: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.project.appUrl', 'App URL')}>
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={project.appUrl}
            onChange={(event) => set({ appUrl: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.project.testCommand', 'Tests and checks')}
        hint={t(
          'components.harness.project.testCommandHint',
          'Verifies each wave when the waves node has no command of its own.'
        )}
      >
        {(id) => (
          <Input
            id={id}
            variant="code"
            value={project.testCommand}
            onChange={(event) => set({ testCommand: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField
        label={t('components.harness.project.evidenceTool', 'How to capture evidence')}
      >
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={project.evidenceTool}
            onChange={(event) => set({ evidenceTool: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorField label={t('components.harness.project.notes', 'Repository rules')}>
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={project.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        )}
      </InspectorField>
      <InspectorSwitch
        label={t('components.harness.project.stacked', 'Stacked PRs, one per wave')}
        hint={t(
          'components.harness.project.stackedHint',
          'Each wave opens its own PR on top of the previous one. Needs “Commit after each wave”.'
        )}
        checked={project.prMode === 'stacked'}
        onChange={(stacked) => set({ prMode: stacked ? 'stacked' : 'single' })}
      />
    </section>
  )
}
