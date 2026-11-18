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
  private readonly deps: FanControlLoopDeps

  constructor(deps: FanControlLoopDeps) {
    this.deps = deps
  }

  async readFanStatus(): Promise<void> {
    const appliedBefore = this.appliedRpm
    const output = await readFanHelperStatus(this.deps.runHelper)
    this.hasReading = true
    this.smcUnavailable = !output
    if (!output) {
      return
    }
    this.fans = output.fans
    // Only targets already in force before this read count; a fresh write may not be applied yet.
    const holdExited =
      this.deps.lease.state === 'active' &&
      !this.suspended &&
      output.mode === 'auto' &&
      this.appliedRpm === appliedBefore &&
      appliedBefore.some((target) => target !== null)
    if (holdExited) {
      this.mode = 'auto'
      this.hotBoost = null
      this.appliedRpm = this.fans.map(() => null)
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
    await this.applyModeTargets(now)
  }

  async writeTargets(targets: (number | null)[]): Promise<void> {
    if (this.released) {
      return
    }
    this.appliedRpm = targets
    await this.deps.lease.writeTargets(targets)
  }

  private async applyModeTargets(now: number): Promise<void> {
    if (this.deps.lease.state !== 'active' || this.released) {
      this.appliedRpm = this.fans.map(() => null)
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
}
