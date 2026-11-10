import type { TopodTerminalCensus } from '../../../shared/topod-terminal-census'
import type { TopodRollbackResult } from '../install/topod-remote-rollback'

export function rollbackRecountRefusal(census: TopodTerminalCensus): TopodRollbackResult | null {
  const live = census.liveSessions
  if (live === 0) {
    return null
  }
  return {
    outcome: 'refused',
    code: live === null ? 'topod_rollback_census_unavailable' : 'topod_rollback_terminals_running',
    reason:
      live === null
        ? 'The server did not answer how many terminals it runs. Retry when it answers.'
        : 'A terminal opened on this server before it could be stopped; close it, then retry.'
  }
}

export const ROLLBACK_STALE_COUNT: TopodRollbackResult = {
  outcome: 'refused',
  code: 'topod_rollback_census_unavailable',
  reason: 'The terminal count went stale before the server could be stopped. Retry the rollback.'
}
