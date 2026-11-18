import {
  FAN_CONTROL_HELPER_COMMANDS,
  type FanControlHelperSensorsOutput,
  type FanControlHelperStatusOutput
} from '../../shared/fan-control-contract'
import { parseFanControlStatusOutput, parseFanSensorsOutput } from './fan-control-helper-protocol'

type HelperResult = { code: number | null; stdout: string; stderr: string }

export type RunFanHelper = (args: string[]) => Promise<HelperResult>

async function readHelperJson<T>(
  runHelper: RunFanHelper,
  command: string,
  parse: (stdout: string) => T | null
): Promise<T | null> {
  try {
    const result = await runHelper([command])
    return result.code === 0 ? parse(result.stdout) : null
  } catch (error) {
    console.warn(`[fan-control] ${command} helper failed:`, error)
    return null
  }
}

/** Unprivileged fan readings; null when the SMC cannot be read. */
export function readFanHelperStatus(
  runHelper: RunFanHelper
): Promise<FanControlHelperStatusOutput | null> {
  return readHelperJson(runHelper, FAN_CONTROL_HELPER_COMMANDS.status, parseFanControlStatusOutput)
}

/** Unprivileged temperature sensors grouped by chip, palm rest and battery. */
export function readFanHelperSensors(
  runHelper: RunFanHelper
): Promise<FanControlHelperSensorsOutput | null> {
  return readHelperJson(runHelper, FAN_CONTROL_HELPER_COMMANDS.sensors, parseFanSensorsOutput)
}
