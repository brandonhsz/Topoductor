import { existsSync } from 'node:fs'
import path from 'node:path'

/** Whether the app under test was built with TOPO_LAYOUT_OWNER=main. */
export const LAYOUT_OWNER_BUILD = existsSync(
  path.join(process.cwd(), 'out', 'main', 'TOPO_LAYOUT_OWNER_MAIN')
)
