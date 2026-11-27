// The edge's HostRelay plus the two director reads a single-cell relay needs, run inside the
// host's own object so the assignment and the credentials stay where the edge already keeps them.
import { HostRelay } from '../host-relay'
import { LEASE_BASE_MS } from '../host-relay-base'

export class SoloHostRelay extends HostRelay {
  // The host's current epoch on this cell, minting the next one when it is not placed here yet.
  async soloAssign(userId: string, relayHostId: string): Promise<number | null> {
    const cellId = this.config.cellId
    const current = this.store.assignment()
    if (current && current.userId === userId && current.cellId === cellId && !this.store.frozen()) {
      return current.assignmentEpoch
    }
    const result = await this.adminAssign(
      { userId, relayHostId, cellId, assignmentEpoch: (current?.assignmentEpoch ?? 0) + 1 },
      null
    )
    return result.outcome === 'applied' || result.outcome === 'unchanged' ? result.assignmentEpoch : null
  }

  // A phone's resume token still names a device of this host: answer with the host's placement.
  async soloResolve(relayHostId: string, resumeToken: string): Promise<{ assignmentEpoch: number; leaseExpiresAt: number } | null> {
    const current = this.store.assignment()
    if (!current || current.relayHostId !== relayHostId || current.cellId !== this.config.cellId) { return null }
    const found = await this.backend.lookupResume(relayHostId, resumeToken)
    return found.outcome === 'resume'
      ? { assignmentEpoch: current.assignmentEpoch, leaseExpiresAt: Date.now() + LEASE_BASE_MS }
      : null
  }
}
