import {
  FAN_CONTROL_SESSION_READY_LINE,
  FAN_CONTROL_SESSION_WRITE_REJECTED_LINE,
  type FanControlError,
  type FanControlSession
} from '../../shared/fan-control-contract'
import {
  buildFanControlSessionCommand,
  isPrivilegePromptCancelled,
  serializeFanTargets
} from './fan-control-helper-protocol'

export type FanControlLeaseDeps = {
  helperPath: string | null
  leasePath: string
  pid: number
  runPrivileged: (command: string) => Promise<void>
  fs: {
    writeFile: (path: string, data: string) => Promise<void>
    readFile: (path: string) => Promise<string | null>
    rm: (path: string) => Promise<void>
    rmSync: (path: string) => void
  }
  sleep?: (ms: number) => Promise<void>
  readyTimeoutMs?: number
}

export type FanControlSessionOpening =
  | { kind: 'ready' }
  | { kind: 'released' }
  | { kind: 'write-rejected' }
  | { kind: 'failed'; error: FanControlError }

const LEASE_PENDING = 'pending'
const READY_POLL_STEP_MS = 100
const DEFAULT_READY_TIMEOUT_MS = 5_000

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns the lease file shared with the root `control` loop: opening, target lines and removal. */
export class FanControlSessionLease {
  state: FanControlSession = 'none'
  private readonly deps: FanControlLeaseDeps
  private readonly isReleased: () => boolean
  private lastLine: string | null = null
  private opening: Promise<FanControlSessionOpening> | null = null

  constructor(deps: FanControlLeaseDeps, isReleased: () => boolean) {
    this.deps = deps
    this.isReleased = isReleased
  }

  /** Concurrent callers share one password prompt; `onPending` fires once it is about to show. */
  ensureOpen(onPending: () => void): Promise<FanControlSessionOpening> {
    this.opening ??= this.openTracked(onPending).finally(() => {
      this.opening = null
    })
    return this.opening
  }

  async close(): Promise<void> {
    this.state = 'none'
    await this.remove()
  }

  /** Synchronous so it completes before Electron exits; the root loop restores macOS control. */
  closeSync(): void {
    if (this.state === 'none') {
      return
    }
    this.state = 'none'
    this.lastLine = null
    try {
      this.deps.fs.rmSync(this.deps.leasePath)
    } catch (error) {
      console.warn('[fan-control] Failed to remove lease on quit:', error)
    }
  }

  private async openTracked(onPending: () => void): Promise<FanControlSessionOpening> {
    this.state = 'pending'
    onPending()
    const opening = await this.open()
    this.state = opening.kind === 'ready' && !this.isReleased() ? 'active' : 'none'
    return opening
  }

  private async open(): Promise<FanControlSessionOpening> {
    const { helperPath, leasePath, pid } = this.deps
    this.lastLine = null
    try {
      await this.deps.fs.writeFile(leasePath, LEASE_PENDING)
    } catch (error) {
      return this.fail({ kind: 'helper-failed', detail: errorDetail(error) })
    }
    const command = buildFanControlSessionCommand({
      helperPath: helperPath ?? '',
      parentPid: pid,
      leasePath
    })
    try {
      await this.deps.runPrivileged(command)
    } catch (error) {
      return this.fail(
        isPrivilegePromptCancelled(error)
          ? { kind: 'auth-cancelled' }
          : { kind: 'helper-failed', detail: errorDetail(error) }
      )
    }
    const signal = await this.awaitSignal()
    if (this.isReleased()) {
      return { kind: 'released' }
    }
    if (signal === FAN_CONTROL_SESSION_WRITE_REJECTED_LINE) {
      await this.remove()
      return { kind: 'write-rejected' }
    }
    if (signal !== FAN_CONTROL_SESSION_READY_LINE) {
      return this.fail({
        kind: 'helper-failed',
        detail: 'Fan control session did not become ready'
      })
    }
    return { kind: 'ready' }
  }

  /** Rewrites the same inode the root loop holds open; identical lines are skipped. */
  async writeTargets(targets: readonly (number | null)[]): Promise<void> {
    const line = serializeFanTargets(targets)
    if (line === this.lastLine || this.isReleased()) {
      return
    }
    try {
      await this.deps.fs.writeFile(this.deps.leasePath, line)
      this.lastLine = line
    } catch (error) {
      console.warn('[fan-control] Failed to write fan targets:', error)
    }
  }

  private async remove(): Promise<void> {
    this.lastLine = null
    try {
      await this.deps.fs.rm(this.deps.leasePath)
    } catch (error) {
      console.warn('[fan-control] Failed to remove lease:', error)
    }
  }

  private async fail(error: FanControlError): Promise<FanControlSessionOpening> {
    await this.remove()
    return { kind: 'failed', error }
  }

  private async awaitSignal(): Promise<string | null> {
    const sleep = this.deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    const timeoutMs = this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    let lease: string | null = null
    for (let elapsed = 0; elapsed <= timeoutMs; elapsed += READY_POLL_STEP_MS) {
      lease = (await this.deps.fs.readFile(this.deps.leasePath))?.trim() ?? null
      if (
        lease === null ||
        lease === FAN_CONTROL_SESSION_READY_LINE ||
        lease === FAN_CONTROL_SESSION_WRITE_REJECTED_LINE ||
        this.isReleased()
      ) {
        return lease
      }
      await sleep(READY_POLL_STEP_MS)
    }
    return lease
  }
}
