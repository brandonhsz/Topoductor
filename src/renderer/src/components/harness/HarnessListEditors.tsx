import React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type {
  HarnessStartField,
  HarnessWaveRole
} from '../../../../shared/harness/harness-flow-types'
import { AgentSelect, ListInput, useRowKeys } from './harness-inspector-fields'

export function StartFieldsEditor({
  fields,
  onChange
}: {
  fields: HarnessStartField[]
  onChange: (fields: HarnessStartField[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const rows = useRowKeys(fields.length)
  const update = (index: number, patch: Partial<HarnessStartField>): void =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium">
        {t('components.harness.inspector.startFields', 'What the run asks for')}
      </p>
      {fields.map((field, index) => (
        <div
          key={rows.keys[index]}
          className="flex flex-col gap-1.5 rounded-md border border-border p-2"
        >
          <div className="flex items-center gap-1.5">
            <Input
              variant="code"
              value={field.key}
              aria-label={t('components.harness.inspector.fieldKey', 'Variable')}
              onChange={(event) => update(index, { key: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('components.harness.inspector.removeField', 'Remove field')}
              onClick={() => {
                rows.remove(index)
                onChange(fields.filter((_, i) => i !== index))
              }}
            >
              <X />
            </Button>
          </div>
          <Input
            value={field.label}
            aria-label={t('components.harness.inspector.fieldLabel', 'Question')}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <ListInput
            values={field.options}
            ariaLabel={t('components.harness.inspector.fieldOptionsLabel', 'Options')}
            placeholder={t(
              'components.harness.inspector.fieldOptions',
              'Options separated by commas (empty = free text)'
            )}
            onChange={(options) => update(index, { options })}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t('components.harness.inspector.fieldOptional', 'Optional')}
            </span>
            <Switch
              checked={field.optional}
              onCheckedChange={(optional) => update(index, { optional })}
              aria-label={t('components.harness.inspector.fieldOptional', 'Optional')}
            />
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...fields,
            { key: `campo_${fields.length + 1}`, label: '', options: [], optional: false }
          ])
        }
      >
        <Plus />
        {t('components.harness.inspector.addField', 'Add field')}
      </Button>
    </div>
  )
}

export function WaveRolesEditor({
  roles,
  flowDefault,
  onChange
}: {
  roles: HarnessWaveRole[]
  flowDefault: TuiAgent
  onChange: (roles: HarnessWaveRole[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const rows = useRowKeys(roles.length)
  const update = (index: number, patch: Partial<HarnessWaveRole>): void =>
    onChange(roles.map((role, i) => (i === index ? { ...role, ...patch } : role)))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium">
        {t('components.harness.inspector.roles', 'Roles (sub-agents per task)')}
      </p>
      {roles.map((role, index) => (
        <div
          key={rows.keys[index]}
          className="flex flex-col gap-1.5 rounded-md border border-border p-2"
        >
          <div className="flex items-center gap-1.5">
            <Input
              value={role.name}
              aria-label={t('components.harness.inspector.roleName', 'Role name')}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('components.harness.inspector.removeRole', 'Remove role')}
              onClick={() => {
                rows.remove(index)
                onChange(roles.filter((_, i) => i !== index))
              }}
            >
              <X />
            </Button>
          </div>
          <AgentSelect
            id={`wave-role-${rows.keys[index]}`}
            value={role.agent}
            flowDefault={flowDefault}
            onChange={(agent) => update(index, { agent })}
          />
          <Textarea
            value={role.prompt}
            rows={5}
            aria-label={t('components.harness.inspector.rolePrompt', 'Role prompt')}
            onChange={(event) => update(index, { prompt: event.target.value })}
          />
          <ListInput
            values={role.paths}
            ariaLabel={t('components.harness.inspector.rolePaths', 'Folders this role owns')}
            placeholder={t(
              'components.harness.inspector.rolePathsPlaceholder',
              'Folders it owns, separated by commas'
            )}
            onChange={(paths) => update(index, { paths })}
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...roles, { name: '', agent: null, prompt: '', paths: [] }])}
      >
        <Plus />
        {t('components.harness.inspector.addRole', 'Add role')}
      </Button>
    </div>
  )
}
