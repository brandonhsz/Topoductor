import { TOPO_SESSION_ADDRESS_PREFIX } from '../../../../shared/topo-session-address-prefix'

/** Format bare ids as session addresses (NULL stays NULL); never strip addresses and risk matching handles or Runs. */
export function topoSessionAddressSql(topoSessionIdSql: string): string {
  return `('${TOPO_SESSION_ADDRESS_PREFIX}' || ${topoSessionIdSql})`
}
