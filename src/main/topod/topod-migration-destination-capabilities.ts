import { advertisedTopodMigrationBlobCapabilities } from '../../shared/topod-migration/topod-migration-blob-transfer'
import { SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY } from '../../shared/session-tabs-runtime-capabilities'
import { servesWslMovedPaneHistory } from './topod-migration-wsl-destination'

/**
 * Migration blob kinds this host installs, plus the stored-scrollback read a WSL move's destination
 * serves. Terminal history and the scrollback read stay off everywhere but a WSL host.
 */
export function advertisedTopodMigrationDestinationCapabilities(): string[] {
  const wslHost = servesWslMovedPaneHistory()
  return [
    ...advertisedTopodMigrationBlobCapabilities({ wslHost }),
    ...(wslHost ? [SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY] : [])
  ]
}
