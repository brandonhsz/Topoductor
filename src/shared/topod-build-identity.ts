import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { TOPOD_LAUNCHER_FILENAME, TOPOD_SERVER_ENTRY_FILENAME } from './topod-artifacts'

export const TOPOD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashTopodLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === TOPOD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), TOPOD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, TOPOD_BUILD_HASH_LENGTH)
}
