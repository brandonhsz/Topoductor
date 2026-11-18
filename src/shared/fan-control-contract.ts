export type FanControlMode = 'auto' | 'max'

export type FanReading = {
  index: number
  rpm: number
  minRpm: number
  maxRpm: number
}

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

export type FanControlStatus =
  | { supported: false; reason: FanControlUnsupportedReason }
  | {
      supported: true
      mode: FanControlMode
      fans: FanReading[]
      pending: boolean
      lastError?: FanControlError
    }

export type FanControlSetResult =
  | { ok: true; status: FanControlStatus }
  | { ok: false; error: FanControlError; status: FanControlStatus }

export const FAN_CONTROL_CHANNELS = {
  getStatus: 'fanControl:getStatus',
  setMode: 'fanControl:setMode',
  setMonitoring: 'fanControl:setMonitoring',
  changed: 'fanControl:changed'
} as const

export const FAN_CONTROL_HELPER_BINARY = 'topo-fan-control'

// Helper CLI protocol shared by main and native/fan-control-macos.
export const FAN_CONTROL_HELPER_COMMANDS = {
  status: 'status',
  hold: 'hold'
} as const

export const FAN_CONTROL_HOLD_ARGS = {
  parentPid: '--parent-pid',
  lease: '--lease',
  dryRun: '--dry-run'
} as const

export const FAN_CONTROL_HOLD_READY_LINE = 'ready'

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

export type FanControlHelperErrorOutput = { error: string }

export type FanControlApi = {
  getStatus: () => Promise<FanControlStatus>
  setMode: (mode: FanControlMode) => Promise<FanControlSetResult>
  /** Polls fan RPM while a viewer (e.g. the open menu) needs live readings. */
  setMonitoring: (active: boolean) => void
  onChanged: (callback: (status: FanControlStatus) => void) => () => void
}
