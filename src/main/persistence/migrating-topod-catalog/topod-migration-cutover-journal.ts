/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_TOPOD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedTopodMigrationSourceCutover,
  parseTopodMigrationSourceCutover,
  type TopodMigrationSourceCutover
} from '../../../shared/topod-migration/topod-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from './migration-journal-directory'

class TopodMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'TopodMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setTopodMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'topod-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseTopodMigrationSourceCutover,
  unreadable: (detail) => new TopodMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function topodMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listTopodMigrationSourceCutovers(
  userDataPath: string
): TopodMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findTopodMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): TopodMigrationSourceCutover | null {
  const chain = listTopodMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listTopodMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): TopodMigrationSourceCutover[] {
  const matches = listTopodMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new TopodMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeTopodMigrationSourceCutover(
  userDataPath: string,
  cutover: TopodMigrationSourceCutover
): void {
  const parsed = parseTopodMigrationSourceCutover(cutover)
  const existing = listTopodMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedTopodMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_TOPOD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('topod_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeTopodMigrationSourceCutover(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
}

export function removeTopodMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listTopodMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeTopodMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
