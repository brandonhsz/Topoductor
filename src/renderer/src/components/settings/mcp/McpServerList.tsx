import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { TopoMcpServer } from '../../../../../shared/mcp/topo-mcp-server-types'
import { TOPO_MCP_MAX_SERVERS } from '../../../../../shared/mcp/topo-mcp-server-types'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Switch } from '../../ui/switch'
import { McpServerEditorDialog } from './McpServerEditorDialog'
import { mcpServerSecretKeys } from './mcp-server-draft'

type McpServerListProps = {
  servers: readonly TopoMcpServer[]
  onChange: (servers: TopoMcpServer[]) => void
  emptyText: string
}

function serverSummary(server: TopoMcpServer): string {
  return server.transport === 'stdio'
    ? [server.command, ...(server.args ?? [])].join(' ')
    : (server.url ?? '')
}

/** Shared editor for the global and repo lists; both save the whole list on every change. */
export function McpServerList({
  servers,
  onChange,
  emptyText
}: McpServerListProps): React.JSX.Element {
  const t = useTranslate()
  const [editing, setEditing] = useState<{ server: TopoMcpServer | null } | null>(null)
  const takenNames = useMemo(
    () =>
      new Set(
        servers.filter((server) => server.id !== editing?.server?.id).map((server) => server.name)
      ),
    [servers, editing]
  )

  const save = (next: TopoMcpServer): void => {
    const exists = servers.some((server) => server.id === next.id)
    onChange(
      exists ? servers.map((server) => (server.id === next.id ? next : server)) : [...servers, next]
    )
  }
  const remove = (target: TopoMcpServer): void => {
    void Promise.all(mcpServerSecretKeys(target).map((key) => window.api.topoMcp.deleteSecret(key)))
    onChange(servers.filter((server) => server.id !== target.id))
  }

  return (
    <div className="space-y-3">
      {servers.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {servers.map((server) => (
            <li key={server.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{server.name}</span>
                  <Badge variant="outline">
                    {server.transport === 'stdio'
                      ? t('components.settings.mcp.stdio', 'Local command')
                      : t('components.settings.mcp.http', 'Remote URL')}
                  </Badge>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {serverSummary(server)}
                </p>
              </div>
              <Switch
                checked={server.enabled}
                aria-label={t('components.settings.mcp.toggle', 'Enable {{value0}}', {
                  value0: server.name
                })}
                onCheckedChange={(enabled) =>
                  onChange(servers.map((s) => (s.id === server.id ? { ...s, enabled } : s)))
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.settings.mcp.edit', 'Edit {{value0}}', {
                  value0: server.name
                })}
                onClick={() => setEditing({ server })}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.settings.mcp.delete', 'Delete {{value0}}', {
                  value0: server.name
                })}
                onClick={() => remove(server)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={servers.length >= TOPO_MCP_MAX_SERVERS}
        onClick={() => setEditing({ server: null })}
      >
        <Plus />
        {t('components.settings.mcp.add', 'Add server')}
      </Button>
      {editing ? (
        <McpServerEditorDialog
          key={editing.server?.id ?? 'new'}
          server={editing.server}
          takenNames={takenNames}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null)
            }
          }}
          onSave={save}
        />
      ) : null}
    </div>
  )
}
