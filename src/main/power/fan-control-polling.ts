export type FanControlTimers = {
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/** Keeps at most one interval alive and only while it is wanted. */
export class FanControlPolling {
  private readonly timers: FanControlTimers
  private readonly intervalMs: number
  private readonly onTick: () => void
  private poll: { handle: unknown } | null = null

  constructor(timers: FanControlTimers, intervalMs: number, onTick: () => void) {
    this.timers = timers
    this.intervalMs = intervalMs
    this.onTick = onTick
  }

  sync(wanted: boolean): void {
    if (wanted && !this.poll) {
      this.poll = { handle: this.timers.setInterval(this.onTick, this.intervalMs) }
    } else if (!wanted && this.poll) {
      this.timers.clearInterval(this.poll.handle)
      this.poll = null
    }
  }
}
