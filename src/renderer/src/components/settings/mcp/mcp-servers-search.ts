import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from '../search/settings-search-keywords'
import type { SettingsSearchEntry } from '../search/settings-search'

export const getMcpServersPaneSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('components.settings.mcp.title', 'MCP Servers'),
    description: translate(
      'components.settings.mcp.description',
      'MCP servers Topo adds when it launches Claude Code, Codex or Cursor.'
    ),
    keywords: [
      ...translateSearchKeyword('components.settings.mcp.keywordMcp', 'mcp'),
      ...translateSearchKeyword(
        'components.settings.mcp.keywordProtocol',
        'model context protocol'
      ),
      ...translateSearchKeyword('components.settings.mcp.keywordTools', 'tools'),
      ...translateSearchKeyword('components.settings.mcp.keywordClaude', 'claude')
    ]
  }
])
