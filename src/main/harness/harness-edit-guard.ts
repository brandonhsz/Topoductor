import { getHarnessRunService } from './harness-run-registry'

/** File-writing tools across agents; shells stay allowed so the agent can still read and run checks. */
const EDIT_TOOLS = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'apply_patch',
  'edit_file',
  'write_file'
])

export const HARNESS_EDIT_DENIED =
  'Topo Harness: el paso actual del flujo no permite editar archivos. Corre `topo harness status` para ver qué toca hacer.'

/** The deny reason when a Harness flow forbids `tool` for this caller now; null lets it run. */
export function harnessEditDenial(
  tool: string | undefined,
  caller: { sessionId: string | null; worktreeId: string | null }
): string | null {
  if (!tool || !EDIT_TOOLS.has(tool)) {
    return null
  }
  const service = getHarnessRunService()
  return service && !service.editsAllowed(caller) ? HARNESS_EDIT_DENIED : null
}
