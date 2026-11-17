import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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

export function HarnessStartFieldsForm({
  fields,
  values,
  onChange
}: {
  fields: readonly HarnessStartField[]
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <Label htmlFor={`harness-field-${field.key}`}>{field.label}</Label>
          {field.options.length > 0 ? (
            <Select
              value={values[field.key] ?? ''}
              onValueChange={(value) => onChange({ ...values, [field.key]: value })}
            >
              <SelectTrigger id={`harness-field-${field.key}`} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Textarea
              id={`harness-field-${field.key}`}
              rows={3}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function initialFieldValues(fields: readonly HarnessStartField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.options[0] ?? '']))
}

function HarnessRunForm({
  fields,
  onCancel,
  onStart
}: {
  fields: readonly HarnessStartField[]
  onCancel: () => void
  onStart: (values: Record<string, string>) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  const [values, setValues] = useState<Record<string, string>>(() => initialFieldValues(fields))
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = fields.every((field) => field.optional || (values[field.key] ?? '').trim())
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || starting) {
          return
        }
        setStarting(true)
        onStart(values)
          .catch((caught: unknown) =>
            setError(caught instanceof Error ? caught.message : String(caught))
          )
          .finally(() => setStarting(false))
      }}
    >
      <HarnessStartFieldsForm fields={fields} values={values} onChange={setValues} />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('components.harness.run.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!ready || starting}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('components.harness.run.start', 'Run')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function HarnessRunDialog({
  open,
  onOpenChange,
  flowName,
  workspaceName,
  fields,
  onStart
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flowName: string
  workspaceName: string
  fields: readonly HarnessStartField[]
  onStart: (values: Record<string, string>) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent surface="security" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('components.harness.run.title', 'Run «{{flow}}»', { flow: flowName })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'components.harness.run.description',
              'Topo launches each node’s agent in {{workspace}}. Agents can read and change its files.',
              { workspace: workspaceName }
            )}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per open, so every run starts from the field defaults. */}
        <HarnessRunForm fields={fields} onCancel={() => onOpenChange(false)} onStart={onStart} />
      </DialogContent>
    </Dialog>
  )
}
