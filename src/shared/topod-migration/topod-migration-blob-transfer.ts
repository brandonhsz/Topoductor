/** Opaque migration blobs travel beside the signed catalog. Gate each kind by its destination capability:
 * older destinations drop unknown kinds, so clients must refuse before staging. */
import { z } from 'zod'
import {
  TOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  TopodMigrationChunkBase64Schema,
  TopodMigrationDigestSchema,
  TopodMigrationIdentitySchema,
  decodeTopodMigrationChunk
} from './topod-migration-scrollback'
import { requiredRecord } from './topod-migration-dormant-value-validation'
import { assertUniqueKeys } from './topod-migration-manifest-fields'
import { TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../topod-runtime-capabilities'

export const TOPOD_MIGRATION_BLOB_KINDS = [
  'terminal-restore-hints',
  'shell-history',
  'agent-session-records',
  'terminal-history',
  'automation-run-history'
] as const

export type TopodMigrationBlobKind = (typeof TOPOD_MIGRATION_BLOB_KINDS)[number]

type TopodMigrationBlobKindContract = {
  /** Filename-safe, dot-free and lowercase, so a key is one path segment on any filesystem. */
  key: RegExp
  maxBytes: number
  capability: string
}

const MIB = 1024 * 1024

export const TOPOD_MIGRATION_BLOB_KIND_CONTRACTS: Record<
  TopodMigrationBlobKind,
  TopodMigrationBlobKindContract
> = {
  // One JSON document per migration; the received directory already scopes it to the migration.
  'terminal-restore-hints': {
    key: /^migration$/,
    maxBytes: 4 * MIB,
    capability: 'topod.migration-blob.terminal-restore-hints.v1'
  },
  // `hashWorktreeId` (16 hex) plus the shell whose history file it is.
  'shell-history': {
    key: /^[a-f0-9]{16}-(?:zsh|bash|fish)$/,
    maxBytes: 64 * MIB,
    capability: 'topod.migration-blob.shell-history.v1'
  },
  // The agent session id; agent CLIs mint lowercase UUID-like ids.
  'agent-session-records': {
    key: /^[a-z0-9][a-z0-9_-]{0,127}$/,
    maxBytes: 64 * MIB,
    capability: 'topod.migration-blob.agent-session-records.v1'
  },
  // 16 hex of the pane key's sha256; the session id it restores as travels inside.
  'terminal-history': {
    key: /^[a-f0-9]{16}$/,
    maxBytes: 16 * MIB,
    capability: 'topod.migration-blob.terminal-history.v1'
  },
  // One document per migration; the signed manifest names its digest, and commit imports it.
  'automation-run-history': {
    key: /^migration$/,
    maxBytes: 64 * MIB,
    capability: 'topod.migration-blob.automation-run-history.v1'
  }
}

// The same bound the shared chunk decoder enforces for both channels.
export const TOPOD_MIGRATION_BLOB_CHUNK_BYTES = TOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES
export const MAX_TOPOD_MIGRATION_BLOBS = 1024
export const MAX_TOPOD_MIGRATION_BLOB_TOTAL_BYTES = 256 * MIB

/** Byte-for-byte what the destination must hold; empty content is sent as no blob at all. */
export type TopodMigrationBlobDescriptor = {
  blobKind: TopodMigrationBlobKind
  key: string
  sha256: string
  byteLength: number
}

export type TopodMigrationBlobUploadState = TopodMigrationBlobDescriptor & {
  receivedBytes: number
}

export const TOPOD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED =
  'topod_migration_destination_blob_kind_unsupported'

// Windows refuses these as file names whatever the extension, so a key must never be one.
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

export const TopodMigrationBlobDescriptorSchema = z
  .object({
    blobKind: z.enum(TOPOD_MIGRATION_BLOB_KINDS),
    key: z.string().max(256),
    sha256: TopodMigrationDigestSchema,
    byteLength: z.number().int().min(1)
  })
  .superRefine((value, context) => {
    const contract = TOPOD_MIGRATION_BLOB_KIND_CONTRACTS[value.blobKind]
    if (!contract.key.test(value.key) || WINDOWS_RESERVED_FILE_NAME.test(value.key)) {
      context.addIssue({
        code: 'custom',
        message: 'topod_migration_blob_key_invalid'
      })
    }
    if (value.byteLength > contract.maxBytes) {
      context.addIssue({ code: 'custom', message: 'topod_migration_blob_too_large' })
    }
  })

// Not strict: an older host must ignore optional fields a newer client adds.
export const TopodMigrationBlobChunkRequestSchema = z.object({
  migrationId: TopodMigrationIdentitySchema,
  manifestSha256: TopodMigrationDigestSchema,
  blob: TopodMigrationBlobDescriptorSchema,
  offset: z.number().int().nonnegative().max(MAX_TOPOD_MIGRATION_BLOB_TOTAL_BYTES),
  bytesBase64: TopodMigrationChunkBase64Schema
})

export type TopodMigrationBlobChunkRequest = z.infer<typeof TopodMigrationBlobChunkRequestSchema>

export type TopodMigrationBlobChunkResult = {
  migrationId: string
  manifestSha256: string
  blobKind: TopodMigrationBlobKind
  key: string
  receivedBytes: number
}

export function parseTopodMigrationBlobDescriptor(value: unknown): TopodMigrationBlobDescriptor {
  const parsed = TopodMigrationBlobDescriptorSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'topod_migration_blob_descriptor_invalid')
  }
  return {
    blobKind: parsed.data.blobKind,
    key: parsed.data.key,
    sha256: parsed.data.sha256,
    byteLength: parsed.data.byteLength
  }
}

export function assertTopodMigrationBlobSet(
  descriptors: readonly TopodMigrationBlobDescriptor[]
): void {
  if (descriptors.length > MAX_TOPOD_MIGRATION_BLOBS) {
    throw new Error('topod_migration_blobs_too_many')
  }
  assertUniqueKeys([...descriptors], topodMigrationBlobIdentity, 'topod_migration_blob_duplicate')
  const total = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0)
  if (total > MAX_TOPOD_MIGRATION_BLOB_TOTAL_BYTES) {
    throw new Error('topod_migration_blobs_too_large')
  }
}

export function topodMigrationBlobIdentity(
  descriptor: Pick<TopodMigrationBlobDescriptor, 'blobKind' | 'key'>
): string {
  return `${descriptor.blobKind}\0${descriptor.key}`
}

export function sameTopodMigrationBlob(
  left: TopodMigrationBlobDescriptor,
  right: TopodMigrationBlobDescriptor
): boolean {
  return (
    left.blobKind === right.blobKind &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  )
}

/** The channel plus each kind's capability; empty when nothing is sent. */
export function requiredMigrationBlobCapabilities(
  descriptors: readonly Pick<TopodMigrationBlobDescriptor, 'blobKind'>[]
): string[] {
  if (descriptors.length === 0) {
    return []
  }
  const kinds = new Set(descriptors.map((entry) => entry.blobKind))
  return [
    TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...TOPOD_MIGRATION_BLOB_KINDS.filter((kind) => kinds.has(kind)).map(
      (kind) => TOPOD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}

/** The first kind the destination cannot install, so the refusal names what would be lost. */
export function findUnsupportedMigrationBlobKind(
  descriptors: readonly Pick<TopodMigrationBlobDescriptor, 'blobKind'>[],
  capabilities: readonly string[]
): TopodMigrationBlobKind | null {
  const advertised = new Set(capabilities)
  for (const descriptor of descriptors) {
    if (
      !advertised.has(TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY) ||
      !advertised.has(TOPOD_MIGRATION_BLOB_KIND_CONTRACTS[descriptor.blobKind].capability)
    ) {
      return descriptor.blobKind
    }
  }
  return null
}

export function topodMigrationBlobKindUnsupportedBlocker(kind: TopodMigrationBlobKind): string {
  return `${TOPOD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update Topo on this host to move this project's ${kind} to it.`
}

export function decodeTopodMigrationBlobChunk(bytesBase64: string): Buffer {
  return decodeTopodMigrationChunk(bytesBase64, 'topod_migration_blob_chunk_invalid')
}

/** Absent on hosts that predate blobs or hold none staged; both mean every blob starts at 0. */
export function parseTopodMigrationBlobUploadStates(
  value: unknown
): TopodMigrationBlobUploadState[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > MAX_TOPOD_MIGRATION_BLOBS) {
    throw new Error('topod_migration_blob_state_invalid')
  }
  const uploads = value.map((entry) => {
    // Fails closed on an unknown kind by design: only blobs this desktop staged can appear here.
    const record = requiredRecord(entry, 'topod_migration_blob_state_invalid')
    const descriptor = parseTopodMigrationBlobDescriptor(record)
    if (
      !Number.isSafeInteger(record.receivedBytes) ||
      Number(record.receivedBytes) < 0 ||
      Number(record.receivedBytes) > descriptor.byteLength
    ) {
      throw new Error('topod_migration_blob_state_invalid')
    }
    return { ...descriptor, receivedBytes: Number(record.receivedBytes) }
  })
  assertTopodMigrationBlobSet(uploads)
  return uploads
}

export function parseTopodMigrationBlobChunkResult(
  value: unknown,
  request: TopodMigrationBlobChunkRequest
): TopodMigrationBlobChunkResult {
  const record = requiredRecord(value, 'topod_migration_blob_chunk_result_invalid')
  const receivedBytes = request.offset + decodeTopodMigrationBlobChunk(request.bytesBase64).length
  if (
    record.migrationId !== request.migrationId ||
    record.manifestSha256 !== request.manifestSha256 ||
    record.blobKind !== request.blob.blobKind ||
    record.key !== request.blob.key ||
    record.receivedBytes !== receivedBytes
  ) {
    throw new Error('topod_migration_blob_chunk_result_invalid')
  }
  return {
    migrationId: request.migrationId,
    manifestSha256: request.manifestSha256,
    blobKind: request.blob.blobKind,
    key: request.blob.key,
    receivedBytes
  }
}

/** Kinds this build's destination accepts: installed after commit, or imported by the commit itself. */
export const TOPOD_MIGRATION_INSTALLABLE_BLOB_KINDS: readonly TopodMigrationBlobKind[] = [
  'terminal-restore-hints',
  'shell-history',
  'terminal-history',
  'automation-run-history'
]

/** Moved panes' terminal history installs only on a WSL host, the one destination a WSL move has. */
export function advertisedTopodMigrationBlobCapabilities(host: { wslHost: boolean }): string[] {
  return [
    TOPOD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...TOPOD_MIGRATION_INSTALLABLE_BLOB_KINDS.filter(
      (kind) => kind !== 'terminal-history' || host.wslHost
    ).map((kind) => TOPOD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability)
  ]
}
