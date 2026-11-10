import type { Store } from '../loading-store/store'
import {
  listTopodMigrationSourceCutovers,
  setTopodMigrationJournalChangeListener
} from './topod-migration-cutover-journal'

export function installTopodMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncTopodMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listTopodMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncTopodMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[topod-migration] Could not sync scrollback retention:', error)
    }
  }
  setTopodMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
