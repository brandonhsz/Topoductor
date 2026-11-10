// In-place WSL moves require the desktop-launched topod in the source distro to own the unchanged paths.
import type { TopodMigrationManifestSource } from '../../shared/topod-migration/topod-migration-manifest'
import { isTopodMigrationLocalWslSource } from '../../shared/topod-migration/topod-migration-source-kind'
import { isWslHostTopodProcess } from '../ipc/wsl-guest-windows-drive-path'
import { TOPOD_WSL_DISTRO_GUID_ENV } from '../../shared/topod-server-launch-env'

export const TOPOD_MIGRATION_SOURCE_NOT_THIS_HOST = 'topod_migration_source_not_this_host'

export { TOPOD_WSL_DISTRO_GUID_ENV }

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostTopodProcess(env, platform)
}

// E2E hosts stand in for a WSL host's topod; a real one is identified by isWslHostTopodProcess.
export const TOPO_E2E_WSL_MOVE_DESTINATION_ENV = 'TOPO_E2E_WSL_MOVE_DESTINATION'

/**
 * Whether this host is a WSL move's destination: it installs moved panes' terminal history and
 * serves their stored scrollback. Every other host keeps that wire surface off.
 */
export function servesWslMovedPaneHistory(env: NodeJS.ProcessEnv = process.env): boolean {
  return isWslHostTopodProcess(env) || env[TOPO_E2E_WSL_MOVE_DESTINATION_ENV] === '1'
}

export function assertTopodMigrationSourceServedHere(
  source: TopodMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isTopodMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(TOPOD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[TOPOD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(TOPOD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
