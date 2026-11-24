/** First release shipped as Topo. Earlier ones are Orca builds that wrote Orca's on-disk names. */
export const FIRST_TOPO_RELEASE_REF = 'v1.4.256'

function patch(ref: string): number | null {
  const match = /^v1\.4\.(\d+)$/.exec(ref)
  return match ? Number(match[1]) : null
}

/**
 * Data handoffs with an Orca build no longer happen: Topo keeps its own user data directory and
 * renamed the files and ids Orca wrote (`orca-devices.json`, `orca:` item ids), so neither reads
 * the other's rows. Wire-protocol journeys against those builds still run.
 */
export function sharesUserDataWith(ref: string): boolean {
  const released = patch(ref)
  const firstTopo = patch(FIRST_TOPO_RELEASE_REF)
  return released === null || firstTopo === null || released >= firstTopo
}
