import { app } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runProcess } from '@topo/process-host'
import { runMacPrivilegedCommand } from '../cli/cli-privileged-processes'
import { FAN_CONTROL_HELPER_BINARY } from '../../shared/fan-control-contract'
import { FanControlService } from './fan-control-service'

const STATUS_TIMEOUT_MS = 3_000
const STATUS_MAX_OUTPUT_BYTES = 64 * 1024

function resolveFanControlHelperPath(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  // Packaged and dev app bundles both ship the helper next to the executable (Contents/MacOS).
  const candidates = [join(dirname(process.execPath), FAN_CONTROL_HELPER_BINARY)]
  if (!app.isPackaged) {
    candidates.push(
      join(app.getAppPath(), 'native/fan-control-macos/.build/release', FAN_CONTROL_HELPER_BINARY)
    )
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function createFanControlService(): FanControlService {
  const helperPath = resolveFanControlHelperPath()
  return new FanControlService({
    platform: process.platform,
    helperPath,
    leasePath: join(app.getPath('userData'), 'fan-control.lease'),
    pid: process.pid,
    runHelper: (args) =>
      runProcess({
        program: helperPath ?? '',
        args,
        timeoutMs: STATUS_TIMEOUT_MS,
        maxOutputBytes: STATUS_MAX_OUTPUT_BYTES
      }),
    runPrivileged: runMacPrivilegedCommand,
    fs: {
      writeFile: (path, data) => writeFile(path, data, 'utf8'),
      readFile: (path) => readFile(path, 'utf8').catch(() => null),
      rm: (path) => rm(path, { force: true }),
      rmSync: (path) => rmSync(path, { force: true })
    }
  })
}

let fanControlService: FanControlService | null = null

/** Process-wide instance shared by startup observers and IPC registration. */
export function getFanControlService(): FanControlService {
  fanControlService ??= createFanControlService()
  return fanControlService
}
