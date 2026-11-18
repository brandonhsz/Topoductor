import { app } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runProcess } from '@topo/process-host'
import { runMacPrivilegedCommand } from '../cli/cli-privileged-processes'
import {
  FAN_CONTROL_HELPER_BINARY,
  type FanControlGlobalSettings
} from '../../shared/fan-control-contract'
import { FanControlService, type FanControlServiceDeps } from './fan-control-service'

const HELPER_TIMEOUT_MS = 3_000
const HELPER_MAX_OUTPUT_BYTES = 64 * 1024

/** The main settings store satisfies this structurally; startup hands it over once it exists. */
export type FanControlSettingsSource = {
  getSettings: () => FanControlGlobalSettings
  updateSettings: (patch: Partial<FanControlGlobalSettings>) => unknown
}

const FALLBACK_SETTINGS: FanControlGlobalSettings = { fanSmartFeedbackPrompts: true }

let settingsSource: FanControlSettingsSource | null = null

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

// Handles stay typed here so the service can treat them as opaque.
function createIntervalTimers(): FanControlServiceDeps['timers'] {
  const active = new Set<ReturnType<typeof setInterval>>()
  return {
    setInterval: (callback, ms) => {
      const handle = setInterval(callback, ms)
      active.add(handle)
      return handle
    },
    clearInterval: (handle) => {
      for (const candidate of active) {
        if (candidate === handle) {
          clearInterval(candidate)
          active.delete(candidate)
        }
      }
    }
  }
}

export function createFanControlService(): FanControlService {
  const helperPath = resolveFanControlHelperPath()
  return new FanControlService({
    platform: process.platform,
    helperPath,
    leasePath: join(app.getPath('userData'), 'fan-control.lease'),
    profilePath: join(app.getPath('userData'), 'fan-control-profile.json'),
    pid: process.pid,
    runHelper: (args) =>
      runProcess({
        program: helperPath ?? '',
        args,
        timeoutMs: HELPER_TIMEOUT_MS,
        maxOutputBytes: HELPER_MAX_OUTPUT_BYTES
      }),
    runPrivileged: runMacPrivilegedCommand,
    getSettings: () => ({
      fanSmartFeedbackPrompts:
        settingsSource?.getSettings().fanSmartFeedbackPrompts ??
        FALLBACK_SETTINGS.fanSmartFeedbackPrompts
    }),
    updateSettings: (patch) => {
      if (!settingsSource) {
        console.warn('[fan-control] Settings store not attached; dropping', patch)
        return
      }
      settingsSource.updateSettings(patch)
    },
    now: Date.now,
    timers: createIntervalTimers(),
    fs: {
      writeFile: (path, data) => writeFile(path, data, 'utf8'),
      readFile: (path) => readFile(path, 'utf8').catch(() => null),
      rename: (from, to) => rename(from, to),
      rm: (path) => rm(path, { force: true }),
      rmSync: (path) => rmSync(path, { force: true })
    }
  })
}

let fanControlService: FanControlService | null = null

/** Process-wide instance shared by startup observers and IPC registration; startup passes the settings store. */
export function getFanControlService(settings?: FanControlSettingsSource): FanControlService {
  if (settings) {
    settingsSource = settings
  }
  fanControlService ??= createFanControlService()
  return fanControlService
}
