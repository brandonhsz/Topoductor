import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { TOPOD_SERVER_ENTRY_FILENAME } from '../../shared/topod-artifacts'
import { assertTopodServerRuntime, handoffToBundledTopod } from './topod-bundled-runtime'
import { TOPOD_EXIT_CONFIGURATION } from './topod-configuration-exit'
import { enableManagedTopodCompileCache } from './topod-compile-cache'

declare const TOPOD_SERVER_SHA256: string

let loadServer: (() => void) | undefined

try {
  if (!handoffToBundledTopod()) {
    assertTopodServerRuntime()
    const entry = realpathSync(process.argv[1] ?? __filename)
    const server = join(dirname(entry), TOPOD_SERVER_ENTRY_FILENAME)
    if (createHash('sha256').update(readFileSync(server)).digest('hex') !== TOPOD_SERVER_SHA256) {
      throw new Error('The Topo server does not match its launcher')
    }
    loadServer = () => {
      enableManagedTopodCompileCache(dirname(entry))
      createRequire(entry)(server)
    }
  }
} catch (error) {
  console.error('topod: failed to launch:', error)
  process.exit(TOPOD_EXIT_CONFIGURATION)
}

loadServer?.()
