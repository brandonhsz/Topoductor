import type {
  FanControlError,
  FanControlGlobalSettings,
  FanControlMode,
  FanControlSetResult,
  FanControlStatus,
  FanControlUnsupportedReason,
  FanCurve,
  FanFeedbackReply,
  ThermalSample
} from '../../shared/fan-control-contract'
import { FanControlLoop } from './fan-control-loop'
import { hotBoostFor, manualRpmProblem, nextManualRpm } from './fan-control-mode-targets'
import { FanControlPolling, type FanControlTimers } from './fan-control-polling'
import {
  cloneFanCurve,
  FanControlProfileStore,
  initialSmartProfile
} from './fan-control-profile-store'
import { FanControlSessionLease, type FanControlLeaseDeps } from './fan-control-session-lease'
import { validateFanCurve } from './fan-curve-model'
import { FanFeedbackPromptState } from './fan-feedback-prompt-state'
import type { RunFanHelper } from './fan-helper-readings'
import { FanThermalHistory } from './fan-thermal-history'
import { FanViewerLease } from './fan-viewer-lease'
import { applyFeedback } from './smart-fan-profile'

export type FanControlServiceDeps = FanControlLeaseDeps & {
  platform: NodeJS.Platform
  profilePath: string
  runHelper: RunFanHelper
  getSettings: () => FanControlGlobalSettings
  updateSettings: (patch: Partial<FanControlGlobalSettings>) => void
  now: () => number
  timers: FanControlTimers
  fs: FanControlLeaseDeps['fs'] & { rename: (from: string, to: string) => Promise<void> }
}

type Listener = (status: FanControlStatus) => void

const TICK_INTERVAL_MS = 2_000

function unsupportedFailure(
  status: Extract<FanControlStatus, { supported: false }>
): FanControlSetResult {
  return { ok: false, error: { kind: 'helper-failed', detail: status.reason }, status }
}

export class FanControlService {
  private readonly deps: FanControlServiceDeps
  private readonly lease: FanControlSessionLease
  private readonly profile: FanControlProfileStore
  private readonly polling: FanControlPolling
  private readonly history = new FanThermalHistory()
  private readonly feedback = new FanFeedbackPromptState()
  private readonly loop: FanControlLoop
  private readonly listeners = new Set<Listener>()
  private writeRejected = false
  // Missing three pings means the viewer's window hid or closed.
  private readonly viewer = new FanViewerLease(3 * TICK_INTERVAL_MS)
  // A later setMode wins over one still waiting on the password prompt.
  private modeRequest = 0
  private inflightRefresh: Promise<FanControlStatus> | null = null
  private tickChain: Promise<unknown> = Promise.resolve()

  constructor(deps: FanControlServiceDeps) {
    this.deps = deps
    this.lease = new FanControlSessionLease(deps, () => this.loop.released)
    this.profile = new FanControlProfileStore({ path: deps.profilePath, fs: deps.fs })
    this.polling = new FanControlPolling(deps.timers, TICK_INTERVAL_MS, () => {
      if (this.syncPolling()) {
        void this.tick()
      }
    })
    this.loop = new FanControlLoop({
      ...deps,
      lease: this.lease,
      profile: this.profile,
      history: this.history,
      feedback: this.feedback
    })
  }

  async getStatus(): Promise<FanControlStatus> {
    const fixed = this.fixedUnsupportedReason()
    if (fixed) {
      return { supported: false, reason: fixed }
    }
    await this.profile.ensureLoaded()
    return this.loop.hasReading ? this.snapshot() : this.refresh()
  }

  refresh(): Promise<FanControlStatus> {
    this.inflightRefresh ??= this.observe(() => this.loop.readFanStatus()).finally(() => {
      this.inflightRefresh = null
    })
    return this.inflightRefresh
  }

  getHistory(): Promise<ThermalSample[]> {
    return Promise.resolve(this.history.list())
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A viewer (e.g. the open panel) needs live readings even while macOS owns the fans; repeat calls only renew its lease. */
  setMonitoring(active: boolean): void {
    const started = this.viewer.update(active, this.deps.now())
    if (this.syncPolling() && started && this.loop.mode === 'auto') {
      void this.tick()
    }
  }

  async setMode(mode: FanControlMode): Promise<FanControlSetResult> {
    const request = ++this.modeRequest
    const status = await this.getStatus()
    if (!status.supported) {
      return unsupportedFailure(status)
    }
    if (mode !== 'auto' && !status.controllable) {
      return { ok: false, error: { kind: 'not-controllable' }, status }
    }
    if (mode !== 'auto' && this.lease.state !== 'active') {
      const failure = await this.openSession()
      if (failure) {
        return failure
      }
    }
    if (request !== this.modeRequest) {
      return { ok: true, status: this.snapshot() }
    }
    this.loop.mode = mode
    this.loop.hotBoost = null
    this.loop.lastError = undefined
    this.profile.pausedMode = null
    await this.profile.update({ lastMode: mode })
    this.syncPolling()
    await this.tick()
    return { ok: true, status: this.emit() }
  }

  async setCurve(curve: FanCurve): Promise<FanControlSetResult> {
    const status = await this.getStatus()
    if (!status.supported) {
      return unsupportedFailure(status)
    }
    const validation = validateFanCurve(curve)
    if (!validation.ok) {
      const error: FanControlError = { kind: 'invalid-curve', detail: validation.detail }
      return { ok: false, error, status: this.snapshot() }
    }
    await this.profile.update({ curve: cloneFanCurve(curve) })
    return this.afterProfileChange('curve')
  }

  async setManualRpm(index: number, rpm: number): Promise<FanControlSetResult> {
    const status = await this.getStatus()
    if (!status.supported) {
      return unsupportedFailure(status)
    }
    const fan = this.loop.fans.find((candidate) => candidate.index === index)
    const detail = manualRpmProblem(fan, index, rpm)
    if (detail) {
      return { ok: false, error: { kind: 'invalid-rpm', detail }, status: this.snapshot() }
    }
    const saved = this.loop.mode === 'manual' ? this.profile.current.manualRpm : null
    const manualRpm = nextManualRpm(saved, this.loop.fans, index, rpm)
    await this.profile.update({ manualRpm })
    return this.setMode('manual')
  }

  async answerFeedback(promptId: string, reply: FanFeedbackReply): Promise<FanControlSetResult> {
    await this.profile.ensureLoaded()
    if (reply === 'never') {
      this.deps.updateSettings({ fanSmartFeedbackPrompts: false })
      this.feedback.dismiss()
      return { ok: true, status: this.emit() }
    }
    const now = this.deps.now()
    const prompt = this.feedback.answer(promptId, now)
    if (!prompt) {
      return { ok: true, status: this.snapshot() }
    }
    const learned = applyFeedback(this.profile.current.smart, reply, prompt.tempC)
    if (reply === 'hot') {
      this.loop.hotBoost = hotBoostFor(this.loop.fans, this.loop.appliedRpm, now)
    }
    await this.profile.update({ smart: { ...learned, updatedAt: now } })
    return { ok: true, status: this.emit() }
  }

  async resetSmartProfile(): Promise<FanControlSetResult> {
    await this.profile.ensureLoaded()
    this.loop.hotBoost = null
    await this.profile.update({ smart: initialSmartProfile() })
    return this.afterProfileChange('smart')
  }

  async dismissPausedMode(): Promise<FanControlStatus> {
    await this.profile.ensureLoaded()
    this.profile.pausedMode = null
    if (this.loop.mode === 'auto') {
      await this.profile.update({ lastMode: 'auto' })
    }
    return this.emit()
  }

  /** One control-loop step: read sensors, keep history, schedule feedback and write lease targets. */
  tick(): Promise<FanControlStatus> {
    const run = this.tickChain.then(() => this.observe(() => this.loop.step()))
    this.tickChain = run.catch(() => undefined)
    return run
  }

  /** Synchronous so it completes before Electron exits; the root session restores auto when the lease vanishes. */
  releaseForQuit(): void {
    this.loop.released = true
    this.syncPolling()
    this.lease.closeSync()
  }

  /** macOS owns the fans while asleep; the session stays open so wake needs no password. */
  async handleSuspend(): Promise<void> {
    this.loop.suspended = true
    if (this.lease.state === 'active') {
      await this.loop.writeTargets(this.loop.fans.map(() => null))
      this.emit()
    }
  }

  async handleResume(): Promise<void> {
    this.loop.suspended = false
    if (this.lease.state === 'active' && !this.loop.released) {
      await this.tick()
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
    const fixed = this.fixedUnsupportedReason()
    if (fixed || this.loop.smcUnavailable) {
      return { supported: false, reason: fixed ?? 'smc-unavailable' }
    }
    const { curve, smart, manualRpm } = this.profile.current
    const { mode, fans, thermal, appliedRpm, lastError } = this.loop
    return {
      supported: true,
      controllable: fans.length > 0,
      mode,
      fans,
      thermal,
      curve,
      smart,
      manualRpm,
      appliedRpm,
      session: this.lease.state,
      pausedMode: this.profile.pausedMode,
      feedbackPrompt: this.feedback.current,
      pending: this.lease.state === 'pending',
      ...(lastError ? { lastError } : {})
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

  /** Runs a hardware read and notifies subscribers only when the visible status changed. */
  private async observe(read: () => Promise<void>): Promise<FanControlStatus> {
    const fixed = this.fixedUnsupportedReason()
    if (fixed) {
      return { supported: false, reason: fixed }
    }
    await this.profile.ensureLoaded()
    const previous = JSON.stringify(this.snapshot())
    await read()
    this.syncPolling()
    const status = this.snapshot()
    return JSON.stringify(status) === previous ? status : this.emit()
  }

  private async afterProfileChange(mode: FanControlMode): Promise<FanControlSetResult> {
    if (this.loop.mode === mode && this.lease.state === 'active') {
      await this.tick()
    }
    return { ok: true, status: this.emit() }
  }

  /** Starts or stops the interval; returns whether a tick is still wanted. */
  private syncPolling(): boolean {
    const watched = this.viewer.activeAt(this.deps.now())
    const wanted = !this.loop.released && (watched || this.loop.mode !== 'auto')
    this.polling.sync(wanted)
    return wanted
  }

  private async openSession(): Promise<FanControlSetResult | null> {
    const opening = await this.lease.ensureOpen(() => {
      this.loop.lastError = undefined
      this.emit()
    })
    if (this.lease.state === 'active') {
      return null
    }
    if (opening.kind === 'write-rejected') {
      this.writeRejected = true
      const error: FanControlError = { kind: 'helper-failed', detail: 'write-rejected' }
      return { ok: false, error, status: this.emit() }
    }
    if (opening.kind === 'failed') {
      this.loop.lastError = opening.error
      return { ok: false, error: opening.error, status: this.emit() }
    }
    return { ok: true, status: this.emit() }
  }
}
