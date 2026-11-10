import { TOPOD_IDLE_TIMEOUT_ENV } from './topod-idle-exit'
import { TOPOD_MANAGED_ACTIVATION_ROOT_ENV } from './topod-managed-launch-env'

/** WSL-host launch marker; SSH guests and WSLg retain their original PATH. */
export const TOPOD_WSL_HOST_ENV = 'TOPO_WSL_TOPOD_HOST'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const TOPOD_WSL_DISTRO_GUID_ENV = 'TOPO_WSL_DISTRO_GUID'

/**
 * What a client puts in a server's launch env. A user's own `topod` started from one of the
 * server's shells is not that server, so every pane scrubs these.
 */
export const TOPOD_SERVER_LAUNCH_ENV_KEYS = [
  // Not client-managed.
  TOPOD_MANAGED_ACTIVATION_ROOT_ENV,
  // Keeps the default idle window.
  TOPOD_IDLE_TIMEOUT_ENV,
  // Not a WSL host: no migration capabilities, no /mnt/c refusal, no account-push wait.
  TOPOD_WSL_HOST_ENV,
  TOPOD_WSL_DISTRO_GUID_ENV
] as const
