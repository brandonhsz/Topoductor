import {
  FAN_CONTROL_HELPER_COMMANDS,
  FAN_CONTROL_HOLD_READY_LINE,
  type FanControlError,
  type FanControlHelperStatusOutput,
  type FanControlMode,
  type FanControlSetResult,
  type FanControlStatus,
  type FanControlUnsupportedReason,
  type FanReading
} from '../../shared/fan-control-contract'
import {
  buildFanControlHoldCommand,
  isPrivilegePromptCancelled,
  parseFanControlStatusOutput
} from './fan-control-helper-protocol'

type HelperResult = { code: number | null; stdout: string; stderr: string }

export type FanControlServiceDeps = {
  platform: NodeJS.Platform
  helperPath: string | null
  leasePath: string
  pid: number
  runHelper: (args: string[]) => Promise<HelperResult>
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

type Listener = (status: FanControlStatus) => void

const LEASE_PENDING = 'pending'
const LEASE_WRITE_REJECTED = 'write-rejected'
const READY_POLL_STEP_MS = 100
const DEFAULT_READY_TIMEOUT_MS = 5_000

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FanControlService {
  private readonly deps: FanControlServiceDeps
  private readonly listeners = new Set<Listener>()
  private unsupported: FanControlUnsupportedReason | null = null
  private writeRejected = false
  private hasReading = false
  private mode: FanControlMode = 'auto'
  private pending = false
  private fans: FanReading[] = []
  private lastError: FanControlError | undefined
  // Bumped on every mode change so a refresh started under an older hold cannot misreport it.
  private modeGeneration = 0
  private releaseRequested = false
  private inflightRefresh: Promise<FanControlStatus> | null = null
  private inflightMax: Promise<FanControlSetResult> | null = null

  constructor(deps: FanControlServiceDeps) {
    this.deps = deps
  }

  async getStatus(): Promise<FanControlStatus> {
    const fixed = this.fixedUnsupportedReason()
    if (fixed) {
      return { supported: false, reason: fixed }
    }
    return this.hasReading ? this.snapshot() : this.refresh()
  }

  refresh(): Promise<FanControlStatus> {
    this.inflightRefresh ??= this.readStatus().finally(() => {
      this.inflightRefresh = null
    })
    return this.inflightRefresh
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A viewer asks for a fresh reading; the renderer drives the cadence only while its menu is open. */
  setMonitoring(active: boolean): void {
    if (active) {
      void this.refresh()
    }
  }

  async setMode(mode: FanControlMode): Promise<FanControlSetResult> {
    if (mode === 'auto') {
      return this.releaseToAuto()
    }
    if (this.inflightMax) {
      return this.inflightMax
    }
    const status = await this.getStatus()
    if (!status.supported) {
      return { ok: false, error: { kind: 'helper-failed', detail: status.reason }, status }
    }
    if (this.mode === 'max') {
      return { ok: true, status }
    }
    this.inflightMax = this.startHold().finally(() => {
      this.inflightMax = null
    })
    return this.inflightMax
  }

  /** Synchronous so it completes before Electron exits; the root hold restores auto when the lease vanishes. */
  releaseForQuit(): void {
    if (this.mode !== 'max' && !this.pending) {
      return
    }
    this.releaseRequested = this.pending
    this.mode = 'auto'
    this.modeGeneration++
    try {
      this.deps.fs.rmSync(this.deps.leasePath)
    } catch (error) {
      console.warn('[fan-control] Failed to remove lease on quit:', error)
    }
  }

  async handleSuspend(): Promise<void> {
    if (this.mode === 'max' || this.pending) {
      await this.releaseToAuto()
    }
  }

  private fixedUnsupportedReason(): FanControlUnsupportedReason | null {
    if (this.deps.platform !== 'darwin') {
      return 'not-macos'
    }
    if (!this.deps.helperPath) {
      return 'helper-missing'
    }
    return this.writeRejected ? 'write-rejected' : null
  }

  private snapshot(): FanControlStatus {
    const fixed = this.fixedUnsupportedReason() ?? this.unsupported
    if (fixed) {
      return { supported: false, reason: fixed }
    }
    return {
      supported: true,
      mode: this.mode,
      fans: this.fans,
      pending: this.pending,
      ...(this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private emit(): FanControlStatus {
    const status = this.snapshot()
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(status)
      } catch (error) {
        console.error('[fan-control] Listener failed:', error)
      }
    }
    return status
  }

  private async readStatus(): Promise<FanControlStatus> {
    const fixed = this.fixedUnsupportedReason()
    if (fixed) {
      return { supported: false, reason: fixed }
    }
    const generation = this.modeGeneration
    let output: FanControlHelperStatusOutput | null = null
    try {
      const result = await this.deps.runHelper([FAN_CONTROL_HELPER_COMMANDS.status])
      output = result.code === 0 ? parseFanControlStatusOutput(result.stdout) : null
    } catch (error) {
      console.warn('[fan-control] Status helper failed:', error)
    }
    const previous = JSON.stringify(this.snapshot())
    this.hasReading = true
    if (!output) {
      this.unsupported = 'smc-unavailable'
    } else if (output.fans.length === 0) {
      this.unsupported = 'no-fans'
    } else {
      this.unsupported = null
      this.fans = output.fans
      const holdExited =
        this.mode === 'max' &&
        !this.pending &&
        output.mode === 'auto' &&
        generation === this.modeGeneration
      if (holdExited) {
        this.mode = 'auto'
        this.modeGeneration++
        this.lastError = { kind: 'hold-exited', detail: 'Fans returned to automatic control' }
        await this.removeLease()
      }
    }
    return JSON.stringify(this.snapshot()) === previous ? this.snapshot() : this.emit()
  }

  private async startHold(): Promise<FanControlSetResult> {
    const { helperPath, leasePath, pid } = this.deps
    this.pending = true
    this.releaseRequested = false
    this.lastError = undefined
    this.emit()

    const fail = async (error: FanControlError): Promise<FanControlSetResult> => {
      await this.removeLease()
      this.pending = false
      this.lastError = error
      return { ok: false, error, status: this.emit() }
    }

    try {
      await this.deps.fs.writeFile(leasePath, LEASE_PENDING)
    } catch (error) {
      return fail({ kind: 'helper-failed', detail: errorDetail(error) })
    }
    const command = buildFanControlHoldCommand({
      helperPath: helperPath ?? '',
      parentPid: pid,
      leasePath
    })
    try {
      await this.deps.runPrivileged(command)
    } catch (error) {
      return fail(
        isPrivilegePromptCancelled(error)
          ? { kind: 'auth-cancelled' }
          : { kind: 'helper-failed', detail: errorDetail(error) }
      )
    }

    const lease = await this.awaitHoldSignal()
    if (this.releaseRequested || lease === null) {
      this.pending = false
      return { ok: true, status: this.emit() }
    }
    if (lease === LEASE_WRITE_REJECTED) {
      this.writeRejected = true
      await this.removeLease()
      this.pending = false
      const error: FanControlError = { kind: 'helper-failed', detail: LEASE_WRITE_REJECTED }
      return { ok: false, error, status: this.emit() }
    }
    if (lease !== FAN_CONTROL_HOLD_READY_LINE) {
      return fail({ kind: 'helper-failed', detail: 'Fan hold did not become ready' })
    }
    this.pending = false
    this.mode = 'max'
    this.modeGeneration++
    return { ok: true, status: this.emit() }
  }

  private async awaitHoldSignal(): Promise<string | null> {
    const sleep = this.deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    const timeoutMs = this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    let lease: string | null = null
    for (let elapsed = 0; elapsed <= timeoutMs; elapsed += READY_POLL_STEP_MS) {
      lease = (await this.deps.fs.readFile(this.deps.leasePath))?.trim() ?? null
      if (
        lease === null ||
        lease === FAN_CONTROL_HOLD_READY_LINE ||
        lease === LEASE_WRITE_REJECTED ||
        this.releaseRequested
      ) {
        return lease
      }
      await sleep(READY_POLL_STEP_MS)
    }
    return lease
  }

  private async releaseToAuto(): Promise<FanControlSetResult> {
    if (this.pending) {
      this.releaseRequested = true
    }
    if (this.mode === 'max' || this.pending) {
      this.mode = 'auto'
      this.modeGeneration++
      this.lastError = undefined
      await this.removeLease()
    }
    return { ok: true, status: this.emit() }
  }

  private async removeLease(): Promise<void> {
    try {
      await this.deps.fs.rm(this.deps.leasePath)
    } catch (error) {
      console.warn('[fan-control] Failed to remove lease:', error)
    }
  }
}
