import React, { useEffect, useRef } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { HarnessStartField } from '../../../../shared/harness/harness-flow-types'
import { HARNESS_AUTO_OPTION } from './harness-composer-start'
import { setHarnessComposerChoice, useHarnessComposerChoice } from './harness-composer-choice-store'
import { useHarnessFlows } from './use-harness-data'

const NO_FLOW = '__none__'
const LAST_FLOW_KEY = 'topo.harness.lastFlowByRepo'

function readLastFlows(): Record<string, string | null> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_FLOW_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

export function rememberHarnessFlow(repoId: string, flowId: string | null): void {
  try {
    localStorage.setItem(LAST_FLOW_KEY, JSON.stringify({ ...readLastFlows(), [repoId]: flowId }))
  } catch {
    // A private window only loses the remembered choice.
  }
}

function FieldInput({
  field,
  value,
  onChange
}: {
  field: HarnessStartField
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const id = `harness-composer-${field.key}`
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} variant="settings">
        {field.label}
      </Label>
      {field.options.length > 0 ? (
        <Select value={value || HARNESS_AUTO_OPTION} onValueChange={onChange}>
          <SelectTrigger id={id} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={HARNESS_AUTO_OPTION}>
              {t('components.harness.composer.auto', 'Automatic (from the source)')}
            </SelectItem>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Textarea
          id={id}
          rows={2}
          value={value}
          placeholder={t(
            'components.harness.composer.fromSource',
            'Empty: taken from the issue, ticket or workspace name'
          )}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

/** Picks the Harness flow the new workspace's chat will drive, remembering the last one per repo. */
export function HarnessFlowComposerSection({
  repoId
}: {
  repoId: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const value = useHarnessComposerChoice()
  const onChange = setHarnessComposerChoice
  const { flows } = useHarnessFlows(repoId || null)
  const restoredFor = useRef<string | null>(null)

  useEffect(() => {
    // Restore once per repo, after its flows load; a later pick must not be overwritten.
    if (!flows || restoredFor.current === repoId) {
      return
    }
    restoredFor.current = repoId
    const remembered = readLastFlows()[repoId]
    const flow = remembered ? flows.find((entry) => entry.id === remembered) : null
    onChange(flow ? { flow, fields: {} } : null)
  }, [flows, repoId, onChange])

  if (!flows || flows.length === 0) {
    return null
  }
  const start = value?.flow.nodes.find((node) => node.kind === 'start')
  const fields = start?.kind === 'start' ? start.fields : []
  return (
    <div className="min-w-0 space-y-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="harness-composer-flow">
        {t('components.harness.composer.flow', 'Harness flow [Optional]')}
      </label>
      <Select
        value={value?.flow.id ?? NO_FLOW}
        onValueChange={(flowId) => {
          const flow = flows.find((entry) => entry.id === flowId) ?? null
          rememberHarnessFlow(repoId, flow?.id ?? null)
          onChange(flow ? { flow, fields: {} } : null)
        }}
      >
        <SelectTrigger id="harness-composer-flow" size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FLOW}>{t('components.harness.composer.none', 'None')}</SelectItem>
          {flows.map((flow) => (
            <SelectItem key={flow.id} value={flow.id}>
              {flow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value
        ? fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={value.fields[field.key] ?? ''}
              onChange={(next) =>
                onChange({ ...value, fields: { ...value.fields, [field.key]: next } })
              }
            />
          ))
        : null}
    </div>
  )
}
