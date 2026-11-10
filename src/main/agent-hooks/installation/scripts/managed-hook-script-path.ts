import { homedir } from 'node:os'
import { join } from 'node:path'

// Parallel Topo instances must share one user-wide script path.
export function getSharedManagedScriptPath(scriptFileName: string): string {
  return join(homedir(), '.topo', 'agent-hooks', scriptFileName)
}
