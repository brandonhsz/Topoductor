import {
  FAN_CONTROL_HELPER_COMMANDS,
  FAN_CONTROL_HOLD_ARGS,
  type FanControlHelperStatusOutput,
  type FanReading
} from '../../shared/fan-control-contract'

// POSIX single-quoting: the root shell sees the value verbatim, including embedded quotes.
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildFanControlHoldCommand(args: {
  helperPath: string
  parentPid: number
  leasePath: string
}): string {
  return [
    shellQuote(args.helperPath),
    FAN_CONTROL_HELPER_COMMANDS.hold,
    FAN_CONTROL_HOLD_ARGS.parentPid,
    String(args.parentPid),
    FAN_CONTROL_HOLD_ARGS.lease,
    shellQuote(args.leasePath),
    // Detached so osascript returns while the root hold keeps running.
    '>/dev/null 2>&1 &'
  ].join(' ')
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

export function parseFanControlStatusOutput(stdout: string): FanControlHelperStatusOutput | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || !('fans' in parsed) || !('mode' in parsed)) {
    return null
  }
  const { fans, mode } = parsed
  if (!Array.isArray(fans) || !fans.every(isFanReading) || (mode !== 'auto' && mode !== 'manual')) {
    return null
  }
  return { fans, mode }
}
