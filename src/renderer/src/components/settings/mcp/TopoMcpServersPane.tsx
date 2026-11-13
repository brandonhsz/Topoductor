import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { McpServerList } from './McpServerList'

type TopoMcpServersPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function TopoMcpServersPane({
  settings,
  updateSettings
}: TopoMcpServersPaneProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsGroup
      title={t('components.settings.mcp.globalTitle', 'Every project')}
      description={t(
        'components.settings.mcp.globalDescription',
        'Added to Claude Code, Codex and Cursor launches. A project server with the same name replaces it.'
      )}
      bodyClassName="py-2"
    >
      <McpServerList
        servers={settings.topoMcpServers ?? []}
        onChange={(topoMcpServers) => void updateSettings({ topoMcpServers })}
        emptyText={t('components.settings.mcp.globalEmpty', 'No MCP servers yet.')}
      />
    </SettingsGroup>
  )
}
