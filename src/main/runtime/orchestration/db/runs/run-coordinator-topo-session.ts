import { topoSessionAddressSql } from '../topo-session-address-sql'
import type { TopoSessionId } from '../../../../../shared/topo-session-address'
import type { RunRow } from '../orchestration-records'

type RunCoordinatorTopoSessionFields = Pick<
  RunRow,
  'coordinator_topo_session_id' | 'coordinator_topo_session_id_generation' | 'consumer_generation'
>

/** Count a coordinator session id only at its stamped consumer generation; older writers bump generation without clearing it. */
export function currentRunCoordinatorTopoSessionId(
  run: RunCoordinatorTopoSessionFields
): TopoSessionId | null {
  return run.coordinator_topo_session_id_generation === run.consumer_generation
    ? run.coordinator_topo_session_id
    : null
}

/** The same rule in SQL, for a `runs` row named `row` (a table name, alias, or `NEW`). */
export function currentRunCoordinatorTopoSessionIdSql(row: string): string {
  return `(CASE WHEN ${row}.coordinator_topo_session_id_generation = ${row}.consumer_generation
    THEN ${row}.coordinator_topo_session_id END)`
}

/** The coordinator's `topo_session_id:<id>` address in SQL; NULL when it has no current Topo session id. */
export function currentRunCoordinatorSessionAddressSql(row: string): string {
  return topoSessionAddressSql(currentRunCoordinatorTopoSessionIdSql(row))
}
