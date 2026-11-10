/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  TopodMigrationLocalWslManifestSource,
  TopodMigrationManifestSource,
  TopodMigrationSshManifestSource
} from './topod-migration-manifest'
import { TOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../topod-runtime-capabilities'

export const TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const TOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': TOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type TopodMigrationNonSshSourceKind = keyof typeof TOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type TopodMigrationSourceKind =
  | typeof TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | TopodMigrationNonSshSourceKind

export const TOPOD_MIGRATION_SOURCE_KIND_UNKNOWN = 'topod_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type TopodMigrationWireSource = Readonly<Record<string, unknown>>

export function topodMigrationManifestSourceKind(
  source: TopodMigrationWireSource
): TopodMigrationSourceKind {
  if (source.kind === undefined) {
    return TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(TOPOD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is TopodMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(TOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredTopodMigrationSourceCapability(
  source: TopodMigrationWireSource
): string | null {
  const kind = topodMigrationManifestSourceKind(source)
  return kind === TOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : TOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isTopodMigrationLocalWslSource(
  source: TopodMigrationManifestSource
): source is TopodMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireTopodMigrationSshSource(
  source: TopodMigrationManifestSource
): TopodMigrationSshManifestSource {
  if (isTopodMigrationLocalWslSource(source)) {
    throw new Error('topod_migration_source_not_ssh')
  }
  return source
}
