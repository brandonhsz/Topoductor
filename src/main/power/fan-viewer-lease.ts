/** Who is watching live readings: a viewer re-sends a ping each tick and lapses when its pings stop. */
export class FanViewerLease {
  private readonly ttlMs: number
  private pingAt: number | null = null

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  /** A ping renews the watch and `active: false` ends it; returns true only when this ping starts one. */
  update(active: boolean, now: number): boolean {
    const started = active && this.pingAt === null
    this.pingAt = active ? now : null
    return started
  }

  /** Whether someone still watches; the watch ends once the viewer stopped pinging, e.g. its window hid. */
  activeAt(now: number): boolean {
    if (this.pingAt !== null && now - this.pingAt > this.ttlMs) {
      this.pingAt = null
    }
    return this.pingAt !== null
  }
}
