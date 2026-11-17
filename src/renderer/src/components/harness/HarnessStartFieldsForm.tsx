import React from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
