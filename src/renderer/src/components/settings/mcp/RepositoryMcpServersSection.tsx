import type { Repo } from '../../../../../shared/repo-types'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { McpServerList } from './McpServerList'

export function RepositoryMcpServersSection({
  repo,
  updateRepo
}: {
  repo: Repo
  updateRepo: (repoId: string, updates: Pick<Repo, 'mcpServers'>) => void | Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsGroup
      title={t('components.settings.mcp.repoTitle', 'MCP servers for this project')}
      description={t(
        'components.settings.mcp.repoDescription',
        'Saved only in Topo on this computer. They replace global servers with the same name.'
      )}
      bodyClassName="py-2"
    >
      <McpServerList
        servers={repo.mcpServers ?? []}
        onChange={(mcpServers) => void updateRepo(repo.id, { mcpServers })}
        emptyText={t(
          'components.settings.mcp.repoEmpty',
          'This project uses only the global MCP servers.'
        )}
      />
    </SettingsGroup>
  )
}
