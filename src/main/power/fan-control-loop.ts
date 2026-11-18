import {
  EMPTY_THERMAL_READING,
  type FanControlError,
  type FanControlGlobalSettings,
  type FanControlMode,
  type FanReading,
  type ThermalReading
} from '../../shared/fan-control-contract'
import { fanTargetsFor, type FanHotBoost } from './fan-control-mode-targets'
import type { FanControlProfileStore } from './fan-control-profile-store'
import type { FanControlSessionLease } from './fan-control-session-lease'
import type { FanFeedbackPromptState } from './fan-feedback-prompt-state'
import { readFanHelperSensors, readFanHelperStatus, type RunFanHelper } from './fan-helper-readings'
import type { FanThermalHistory } from './fan-thermal-history'
import { selectThermalReading } from './thermal-blend'

// The root loop sees a new lease line in 200-400 ms and FxMd can take ~1 s to land.
export const HOLD_EXIT_GRACE_MS = 3_000
const HOLD_EXIT_AUTO_READINGS = 2

function anyFixed(targets: readonly (number | null)[]): boolean {
  return targets.some((target) => target !== null)
}

export type FanControlLoopDeps = {
  runHelper: RunFanHelper
  getSettings: () => FanControlGlobalSettings
  now: () => number
  lease: FanControlSessionLease
  profile: FanControlProfileStore
  history: FanThermalHistory
  feedback: FanFeedbackPromptState
}

/** Runtime fan state plus one control step: read the hardware, then write the mode's lease targets. */
export class FanControlLoop {
  mode: FanControlMode = 'auto'
  suspended = false
  released = false
  smcUnavailable = false
  hasReading = false
  fans: FanReading[] = []
  thermal: ThermalReading = EMPTY_THERMAL_READING
  appliedRpm: (number | null)[] = []
  hotBoost: FanHotBoost | null = null
  lastError: FanControlError | undefined
  readAt: number | null = null
  private fixedSince: number | null = null
  private autoReadings = 0
  private readonly deps: FanControlLoopDeps

  constructor(deps: FanControlLoopDeps) {
    this.deps = deps
  }

  async readFanStatus(): Promise<void> {
    const appliedBefore = this.appliedRpm
    const output = await readFanHelperStatus(this.deps.runHelper)
    this.hasReading = true
    this.readAt = this.deps.now()
    this.smcUnavailable = !output
    if (!output) {
      return
    }
    this.fans = output.fans
    // Only targets already in force before this read count; a fresh write may not be applied yet.
    const settled =
      this.deps.lease.state === 'active' &&
      !this.suspended &&
      this.appliedRpm === appliedBefore &&
      this.fixedSince !== null &&
      this.readAt - this.fixedSince >= HOLD_EXIT_GRACE_MS
    this.autoReadings = settled && output.mode === 'auto' ? this.autoReadings + 1 : 0
    if (this.autoReadings >= HOLD_EXIT_AUTO_READINGS) {
      this.mode = 'auto'
      this.hotBoost = null
      this.setApplied(this.fans.map(() => null))
      this.lastError = { kind: 'hold-exited', detail: 'Fans returned to automatic control' }
      await this.deps.lease.close()
    }
  }

  async step(): Promise<void> {
    const { history, feedback } = this.deps
    const [, sensors] = await Promise.all([
      this.readFanStatus(),
      readFanHelperSensors(this.deps.runHelper)
    ])
    if (this.smcUnavailable) {
      return
    }
    const now = this.deps.now()
    this.thermal = sensors
      ? history.record(selectThermalReading(sensors), this.fans, now)
      : EMPTY_THERMAL_READING
    if (!this.suspended) {
      feedback.refresh({
        now,
        mode: this.mode,
        enabled: this.deps.getSettings().fanSmartFeedbackPrompts,
        tempC: this.thermal.blendC,
        history: history.list()
      })
    }
    await this.applyModeTargets()
  }

  async writeTargets(targets: (number | null)[]): Promise<void> {
    if (this.released) {
      return
    }
    this.setApplied(targets)
    await this.deps.lease.writeTargets(targets)
  }

  /** Recomputes the mode's targets from the last reading; runs no helper process. */
  async applyModeTargets(): Promise<void> {
    const now = this.deps.now()
    if (this.deps.lease.state !== 'active' || this.released) {
      this.setApplied(this.fans.map(() => null))
      return
    }
    if (this.hotBoost && now >= this.hotBoost.until) {
      this.hotBoost = null
    }
    const targets = this.suspended
      ? this.fans.map(() => null)
      : fanTargetsFor({
          ...this.deps.profile.current,
          mode: this.mode,
          fans: this.fans,
          thermal: this.thermal,
          previous: this.appliedRpm,
          hotBoost: this.hotBoost
        })
    await this.writeTargets(targets)
  }

  /** Restarts the hold-exit grace whenever fans go from all-macOS to at least one fixed target. */
  private setApplied(targets: (number | null)[]): void {
    if (!anyFixed(targets)) {
      this.fixedSince = null
      this.autoReadings = 0
    } else if (this.fixedSince === null) {
      this.fixedSince = this.deps.now()
    }
    this.appliedRpm = targets
  }
}
