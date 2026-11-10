// Older hosts lack terminalCensus; absent capability means unverifiable, never zero terminals.
export const TOPOD_TERMINAL_CENSUS_RUNTIME_CAPABILITY = 'topod.terminal-census.v1' as const

// Absent capability refuses migration operations instead of calling missing methods on older hosts.
export const TOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY = 'topod.migration-catalog.v1' as const

// Abort by reference releases fences whose manifest cannot fit a request (before #30836). Older hosts lack this method.
export const TOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY =
  'topod.migration-catalog-abort-by-reference.v1' as const

// Gate each non-SSH source kind: older destinations strip source.kind and could misread WSL as SSH.
// Advertise local-wsl only once the destination parses that discriminator.
export const TOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY =
  'topod.migration-source.local-wsl.v1' as const

// The blob channel also requires each installed kind’s topod.migration-blob.<kind>.v1 capability.
export const TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY = 'topod.migration-blob.v1' as const

// Push desktop-owned host accounts (WSL) only to hosts supporting accounts.setHostLaunchEnv.
export const HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY = 'accounts.host-launch-env.v1' as const

// Older topods reject --reclaim-stale-lock; without this capability offer manual instructions.
export const TOPOD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY = 'topod.stale-lock-reclaim.v1' as const

// A WSL host's Remove asks host.peerDesktops before ending a server other desktops may share.
export const TOPOD_PEER_DESKTOPS_RUNTIME_CAPABILITY = 'topod.peer-desktops.v1' as const

export const TOPOD_RUNTIME_CAPABILITIES = [
  TOPOD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY,
  TOPOD_TERMINAL_CENSUS_RUNTIME_CAPABILITY,
  TOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
  TOPOD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY,
  HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY,
  TOPOD_PEER_DESKTOPS_RUNTIME_CAPABILITY
] as const
