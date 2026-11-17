import React, { useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import {
  ALL_TUI_AGENTS,
  tuiAgentDisplayName
} from '../../../../shared/agent-launch/catalog/tui-agent-display-names'
import { isTuiAgent } from '../../../../shared/harness/harness-flow-normalize'

const FLOW_AGENT = '__flow__'

export function InspectorField({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: (id: string) => React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function AgentSelect({
  id,
  value,
  flowDefault,
  onChange
}: {
  id: string
  value: TuiAgent | null
  /** Null hides the "flow default" option, for the flow's own default. */
  flowDefault: TuiAgent | null
  onChange: (agent: TuiAgent | null) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Select
      value={value ?? FLOW_AGENT}
      onValueChange={(next) => onChange(isTuiAgent(next) ? next : null)}
    >
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {flowDefault ? (
          <SelectItem value={FLOW_AGENT}>
            {t('components.harness.inspector.flowAgent', 'Flow default ({{agent}})', {
              agent: tuiAgentDisplayName(flowDefault)
            })}
          </SelectItem>
        ) : null}
        {ALL_TUI_AGENTS.map((agent) => (
          <SelectItem key={agent} value={agent}>
            {tuiAgentDisplayName(agent)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Comma-separated values committed on blur, so typing a comma never drops the draft. */
export function ListInput({
  id,
  values,
  onChange,
  placeholder,
  ariaLabel
}: {
  id?: string
  values: readonly string[]
  onChange: (values: string[]) => void
  placeholder?: string
  ariaLabel?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      value={draft ?? values.join(', ')}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null) {
          onChange(parseList(draft))
          setDraft(null)
        }
      }}
    />
  )
}

let rowKeySeed = 0

/** Stable React keys for editable rows whose own fields (names, keys) change while typing. */
export function useRowKeys(count: number): { keys: string[]; remove: (index: number) => void } {
  const keys = useRef<string[]>([])
  while (keys.current.length < count) {
    keys.current.push(`row-${++rowKeySeed}`)
  }
  keys.current.length = count
  return {
    keys: keys.current,
    remove: (index) => {
      keys.current.splice(index, 1)
    }
  }
}

export function InspectorSwitch({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
