export type FanControlMode = 'auto' | 'max' | 'curve' | 'smart' | 'manual'

/** Modes that need the privileged control session; `auto` hands every fan back to macOS. */
export type FanControlActiveMode = Exclude<FanControlMode, 'auto'>

export const FAN_CONTROL_MODES: readonly FanControlMode[] = [
  'auto',
  'max',
  'curve',
  'smart',
  'manual'
]

export type FanReading = {
  index: number
  rpm: number
  minRpm: number
  maxRpm: number
}

export type TemperatureSource = 'palmrest' | 'chip' | 'blend'

export const TEMPERATURE_SOURCES: readonly TemperatureSource[] = ['palmrest', 'chip', 'blend']

export type ThermalReading = {
  /** Hottest chip sensor (Tp and Te keys on Apple Silicon). */
  chipC: number | null
  /** Mean of the palm-rest sensors; null when this Mac model exposes none. */
  palmrestC: number | null
  /** Chip leads on the way up, palm rest decides when to relax; equals chipC without a palm-rest sensor. */
  blendC: number | null
  palmrestAvailable: boolean
}

export type ThermalSample = ThermalReading & { at: number; fanRpm: number[] }

/** `percent` spans each fan's minRpm..maxRpm; below the first point macOS keeps control. */
export type FanCurvePoint = { tempC: number; percent: number }

export type FanCurve = { source: TemperatureSource; points: FanCurvePoint[] }

export const FAN_CURVE_LIMITS = {
  minPoints: 2,
  maxPoints: 6,
  minTempC: 20,
  maxTempC: 110,
  minPercent: 0,
  maxPercent: 100
} as const

export type FanFeedbackAnswer = 'cold' | 'warm' | 'hot'

export const FAN_FEEDBACK_ANSWERS: readonly FanFeedbackAnswer[] = ['cold', 'warm', 'hot']

/** `never` answers nothing and turns off future smart-mode questions. */
export type FanFeedbackReply = FanFeedbackAnswer | 'never'

export type FanFeedbackPrompt = { id: string; askedAt: number; tempC: number }

export type FanSmartProfile = {
  learned: FanCurvePoint[]
  answers: number
  updatedAt: number | null
}

export type FanControlSession = 'none' | 'pending' | 'active'

export type FanControlUnsupportedReason =
  | 'not-macos'
  | 'no-fans'
  | 'helper-missing'
  | 'smc-unavailable'
  | 'write-rejected'

export type FanControlError =
  | { kind: 'auth-cancelled' }
  | { kind: 'hold-exited'; detail: string }
  | { kind: 'helper-failed'; detail: string }
  | { kind: 'invalid-curve'; detail: string }
  | { kind: 'invalid-rpm'; detail: string }
  | { kind: 'not-controllable' }

export type SupportedFanControlStatus = {
  supported: true
  /** False on fanless Macs: the panel shows temperatures only. */
  controllable: boolean
  mode: FanControlMode
  fans: FanReading[]
  thermal: ThermalReading
  curve: FanCurve
  smart: FanSmartProfile
  manualRpm: Record<number, number>
  /** Target applied per fan right now; null means macOS decides. */
  appliedRpm: (number | null)[]
  session: FanControlSession
  /** Mode from the previous Topo run, paused until the user reactivates it. */
  pausedMode: FanControlActiveMode | null
  feedbackPrompt: FanFeedbackPrompt | null
  pending: boolean
  lastError?: FanControlError
}

export const EMPTY_THERMAL_READING: ThermalReading = {
  chipC: null,
  palmrestC: null,
  blendC: null,
  palmrestAvailable: false
}

/** Neutral values for the fields a status reports before curves, sessions and sensors are wired. */
export const NEUTRAL_SUPPORTED_FAN_STATUS_FIELDS = {
  controllable: true,
  thermal: EMPTY_THERMAL_READING,
  curve: { source: 'blend', points: [] },
  smart: { learned: [], answers: 0, updatedAt: null },
  manualRpm: {},
  appliedRpm: [],
  session: 'none',
  pausedMode: null,
  feedbackPrompt: null
} as const satisfies Omit<
  SupportedFanControlStatus,
  'supported' | 'mode' | 'fans' | 'pending' | 'lastError'
>

export type FanControlStatus =
  | { supported: false; reason: FanControlUnsupportedReason }
  | SupportedFanControlStatus

export type FanControlSetResult =
  | { ok: true; status: FanControlStatus }
  | { ok: false; error: FanControlError; status: FanControlStatus }

export const FAN_CONTROL_CHANNELS = {
  getStatus: 'fanControl:getStatus',
  getHistory: 'fanControl:getHistory',
  setMode: 'fanControl:setMode',
  setCurve: 'fanControl:setCurve',
  setManualRpm: 'fanControl:setManualRpm',
  answerFeedback: 'fanControl:answerFeedback',
  resetSmartProfile: 'fanControl:resetSmartProfile',
  dismissPausedMode: 'fanControl:dismissPausedMode',
  setMonitoring: 'fanControl:setMonitoring',
  changed: 'fanControl:changed'
} as const

export const FAN_CONTROL_HELPER_BINARY = 'topo-fan-control'

// Helper CLI protocol shared by main and native/fan-control-macos.
export const FAN_CONTROL_HELPER_COMMANDS = {
  status: 'status',
  sensors: 'sensors',
  control: 'control'
} as const

export const FAN_CONTROL_SESSION_ARGS = {
  parentPid: '--parent-pid',
  lease: '--lease',
  dryRun: '--dry-run'
} as const

export const FAN_CONTROL_SESSION_READY_LINE = 'ready'
export const FAN_CONTROL_SESSION_WRITE_REJECTED_LINE = 'write-rejected'
export const FAN_CONTROL_TARGETS_VERSION = 1

/** One lease line written by main and read by the root `control` loop; null hands that fan to macOS. */
export type FanControlTargets = {
  v: typeof FAN_CONTROL_TARGETS_VERSION
  targets: (number | null)[]
}

export const FAN_CONTROL_HELPER_EXIT_CODES = {
  ok: 0,
  failure: 1,
  invalidArgs: 2,
  writeRejected: 3
} as const

export type FanControlHelperStatusOutput = {
  fans: FanReading[]
  mode: 'auto' | 'manual'
}

export type FanSensorValue = { key: string; c: number }

export type FanControlHelperSensorsOutput = {
  chip: FanSensorValue[]
  palmrest: FanSensorValue[]
  battery: FanSensorValue[]
}

export type FanControlHelperErrorOutput = { error: string }

export type FanControlGlobalSettings = {
  /** Smart mode asks how the Mac feels; "Don't ask again" turns this off and Settings turns it back on. */
  fanSmartFeedbackPrompts: boolean
}

export type FanControlApi = {
  getStatus: () => Promise<FanControlStatus>
  getHistory: () => Promise<ThermalSample[]>
  setMode: (mode: FanControlMode) => Promise<FanControlSetResult>
  /** Saves the user curve without switching mode. */
  setCurve: (curve: FanCurve) => Promise<FanControlSetResult>
  /** rpm 0 hands that fan to macOS; otherwise minRpm..maxRpm. Switches to `manual`. */
  setManualRpm: (index: number, rpm: number) => Promise<FanControlSetResult>
  /** A stale prompt id resolves ok without learning. */
  answerFeedback: (promptId: string, reply: FanFeedbackReply) => Promise<FanControlSetResult>
  resetSmartProfile: () => Promise<FanControlSetResult>
  dismissPausedMode: () => Promise<FanControlStatus>
  /** Polls sensors while a viewer (e.g. the open panel) needs live readings. */
  setMonitoring: (active: boolean) => void
  onChanged: (callback: (status: FanControlStatus) => void) => () => void
}
