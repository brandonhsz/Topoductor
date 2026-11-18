import {
  FAN_CONTROL_HELPER_COMMANDS,
  FAN_CONTROL_SESSION_ARGS,
  FAN_CONTROL_TARGETS_VERSION,
  type FanControlHelperSensorsOutput,
  type FanControlHelperStatusOutput,
  type FanControlTargets,
  type FanReading,
  type FanSensorValue
} from '../../shared/fan-control-contract'

// POSIX single-quoting: the root shell sees the value verbatim, including embedded quotes.
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildFanControlSessionCommand(args: {
  helperPath: string
  parentPid: number
  leasePath: string
}): string {
  return [
    shellQuote(args.helperPath),
    FAN_CONTROL_HELPER_COMMANDS.control,
    FAN_CONTROL_SESSION_ARGS.parentPid,
    String(args.parentPid),
    FAN_CONTROL_SESSION_ARGS.lease,
    shellQuote(args.leasePath),
    // Detached so osascript returns while the root session keeps running.
    '>/dev/null 2>&1 &'
  ].join(' ')
}

/** The lease line the root `control` loop reads; null hands that fan to macOS. */
export function serializeFanTargets(targets: readonly (number | null)[]): string {
  const line: FanControlTargets = {
    v: FAN_CONTROL_TARGETS_VERSION,
    targets: targets.map((rpm) => (rpm === null ? null : Math.round(rpm)))
  }
  return JSON.stringify(line)
}

/** osascript reports a dismissed administrator prompt as "User canceled. (-128)". */
export function isPrivilegePromptCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
  const text = `${message}\n${stderr}`
  return text.includes('User canceled') || text.includes('(-128)')
}

function isFanReading(value: unknown): value is FanReading {
  return (
    typeof value === 'object' &&
    value !== null &&
    'index' in value &&
    typeof value.index === 'number' &&
    'rpm' in value &&
    typeof value.rpm === 'number' &&
    'minRpm' in value &&
    typeof value.minRpm === 'number' &&
    'maxRpm' in value &&
    typeof value.maxRpm === 'number'
  )
}

function parseHelperJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim())
  } catch {
    return null
  }
}

export function parseFanControlStatusOutput(stdout: string): FanControlHelperStatusOutput | null {
  const parsed = parseHelperJson(stdout)
  if (typeof parsed !== 'object' || parsed === null || !('fans' in parsed) || !('mode' in parsed)) {
    return null
  }
  const { fans, mode } = parsed
  if (!Array.isArray(fans) || !fans.every(isFanReading) || (mode !== 'auto' && mode !== 'manual')) {
    return null
  }
  return { fans, mode }
}

function isSensorGroup(value: unknown): value is FanSensorValue[] {
  return (
    Array.isArray(value) &&
    value.every(
      (reading: unknown) =>
        typeof reading === 'object' &&
        reading !== null &&
        'key' in reading &&
        typeof reading.key === 'string' &&
        'c' in reading &&
        typeof reading.c === 'number'
    )
  )
}

export function parseFanSensorsOutput(stdout: string): FanControlHelperSensorsOutput | null {
  const parsed = parseHelperJson(stdout)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('chip' in parsed) ||
    !('palmrest' in parsed) ||
    !('battery' in parsed)
  ) {
    return null
  }
  const { chip, palmrest, battery } = parsed
  if (!isSensorGroup(chip) || !isSensorGroup(palmrest) || !isSensorGroup(battery)) {
    return null
  }
  return {
    chip: chip.map(({ key, c }) => ({ key, c })),
    palmrest: palmrest.map(({ key, c }) => ({ key, c })),
    battery: battery.map(({ key, c }) => ({ key, c }))
  }
}
