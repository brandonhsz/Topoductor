import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { TopoMcpServer } from '../../../../../shared/mcp/topo-mcp-server-types'
import { topoMcpSecretKey } from '../../../../../shared/mcp/topo-mcp-resolution'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Textarea } from '../../ui/textarea'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import {
  draftFromServer,
  mcpServerSecretKeys,
  newMcpValueRow,
  serverFromDraft,
  validateMcpDraft,
  valueSection,
  type McpDraftError,
  type McpServerDraft,
  type McpValueDraft
} from './mcp-server-draft'

type McpServerEditorDialogProps = {
  /** Null adds a new server. */
  server: TopoMcpServer | null
  takenNames: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onSave: (server: TopoMcpServer) => void
}

export function McpServerEditorDialog({
  server,
  takenNames,
  onOpenChange,
  onSave
}: McpServerEditorDialogProps): React.JSX.Element {
  const t = useTranslate()
  const [draft, setDraft] = useState<McpServerDraft>(() => draftFromServer(server))
  const [stored, setStored] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // The list remounts this dialog per server, so the initial draft is the only one to check.
  useEffect(() => {
    const keys = mcpServerSecretKeys(server)
    if (keys.length) {
      void window.api.topoMcp.secretStatus(keys).then(setStored)
    }
  }, [server])

  const error = useMemo(() => validateMcpDraft(draft, takenNames), [draft, takenNames])
  const shownError = submitted ? error : null
  const errorText: Record<McpDraftError, string> = {
    name: t(
      'components.settings.mcp.errorName',
      'Use letters, numbers, dashes or underscores (up to 64).'
    ),
    'duplicate-name': t(
      'components.settings.mcp.errorDuplicateName',
      'Another server already uses this name.'
    ),
    command: t('components.settings.mcp.errorCommand', 'Enter the command that starts the server.'),
    url: t('components.settings.mcp.errorUrl', 'Enter an http:// or https:// URL.'),
    key: t(
      'components.settings.mcp.errorKey',
      'Each name must be unique and start with a letter or underscore.'
    )
  }

  const update = (patch: Partial<McpServerDraft>): void => setDraft((d) => ({ ...d, ...patch }))
  const updateRow = (rowId: string, patch: Partial<McpValueDraft>): void =>
    setDraft((d) => ({
      ...d,
      values: d.values.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    }))

  const save = async (): Promise<void> => {
    setSubmitted(true)
    if (error) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const result = serverFromDraft(draft, server)
      for (const write of result.secretWrites) {
        const written = await window.api.topoMcp.setSecret(write.key, write.value)
        if (!written.ok) {
          setSaveError(written.error)
          return
        }
      }
      await Promise.all(result.secretDeletes.map((key) => window.api.topoMcp.deleteSecret(key)))
      onSave(result.server)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const section = valueSection(draft.transport)
  const isStdio = draft.transport === 'stdio'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {server
              ? t('components.settings.mcp.editTitle', 'Edit MCP server')
              : t('components.settings.mcp.addTitle', 'Add MCP server')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'components.settings.mcp.editorDescription',
              'Agents launched by Topo receive this server alongside their own MCP config.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mcp-server-name">{t('components.settings.mcp.name', 'Name')}</Label>
            <Input
              id="mcp-server-name"
              autoFocus
              value={draft.name}
              placeholder={t('components.settings.mcp.namePlaceholder', 'github')}
              aria-invalid={shownError === 'name' || shownError === 'duplicate-name'}
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
          <SettingsSegmentedControl<TopoMcpServer['transport']>
            value={draft.transport}
            onChange={(transport) => update({ transport })}
            ariaLabel={t('components.settings.mcp.transport', 'Transport')}
            size="sm"
            options={[
              { value: 'stdio', label: t('components.settings.mcp.stdio', 'Local command') },
              { value: 'http', label: t('components.settings.mcp.http', 'Remote URL') }
            ]}
          />
          {isStdio ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-server-command">
                  {t('components.settings.mcp.command', 'Command')}
                </Label>
                <Input
                  id="mcp-server-command"
                  variant="code"
                  value={draft.command}
                  placeholder={t('components.settings.mcp.commandPlaceholder', 'npx')}
                  aria-invalid={shownError === 'command'}
                  onChange={(event) => update({ command: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-server-args">
                  {t('components.settings.mcp.args', 'Arguments, one per line')}
                </Label>
                <Textarea
                  id="mcp-server-args"
                  variant="code"
                  value={draft.args}
                  placeholder={t(
                    'components.settings.mcp.argsPlaceholder',
                    '-y\n@modelcontextprotocol/server-github'
                  )}
                  onChange={(event) => update({ args: event.target.value })}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-url">{t('components.settings.mcp.url', 'URL')}</Label>
              <Input
                id="mcp-server-url"
                variant="code"
                value={draft.url}
                placeholder={t(
                  'components.settings.mcp.urlPlaceholder',
                  'https://mcp.example.com/mcp'
                )}
                aria-invalid={shownError === 'url'}
                onChange={(event) => update({ url: event.target.value })}
              />
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                {isStdio
                  ? t('components.settings.mcp.envVars', 'Environment variables')
                  : t('components.settings.mcp.headers', 'Headers')}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => update({ values: [...draft.values, newMcpValueRow()] })}
              >
                <Plus />
                {t('components.settings.mcp.addValue', 'Add')}
              </Button>
            </div>
            {draft.values.map((row) => {
              const isStored = row.secret && stored[topoMcpSecretKey(draft.id, section, row.key)]
              return (
                <div key={row.rowId} className="flex items-center gap-2">
                  <Input
                    variant="code"
                    className="w-40"
                    value={row.key}
                    placeholder={
                      isStdio
                        ? t('components.settings.mcp.envPlaceholder', 'API_TOKEN')
                        : t('components.settings.mcp.headerPlaceholder', 'Authorization')
                    }
                    aria-label={t('components.settings.mcp.valueName', 'Name')}
                    aria-invalid={shownError === 'key'}
                    onChange={(event) => updateRow(row.rowId, { key: event.target.value })}
                  />
                  <Input
                    variant="code"
                    className="min-w-0 flex-1"
                    type={row.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={row.value}
                    placeholder={
                      isStored
                        ? t('components.settings.mcp.secretStored', 'Saved — type to replace')
                        : row.secret
                          ? t('components.settings.mcp.secretEmpty', 'Secret value')
                          : ''
                    }
                    aria-label={t('components.settings.mcp.value', 'Value')}
                    onChange={(event) => updateRow(row.rowId, { value: event.target.value })}
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Checkbox
                      id={`${row.rowId}-secret`}
                      checked={row.secret}
                      onCheckedChange={(checked) =>
                        updateRow(row.rowId, { secret: checked === true, value: '' })
                      }
                    />
                    <Label htmlFor={`${row.rowId}-secret`}>
                      {t('components.settings.mcp.secret', 'Secret')}
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('components.settings.mcp.removeValue', 'Remove')}
                    onClick={() =>
                      update({ values: draft.values.filter((other) => other.rowId !== row.rowId) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              )
            })}
            <p className="text-xs text-muted-foreground">
              {t(
                'components.settings.mcp.secretHint',
                'Secret values are encrypted on this computer and passed to the agent only through its environment.'
              )}
            </p>
          </div>
          {shownError || saveError ? (
            <p className="text-xs text-destructive" role="alert">
              {saveError ?? (shownError ? errorText[shownError] : null)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('components.settings.mcp.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('components.settings.mcp.save', 'Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
