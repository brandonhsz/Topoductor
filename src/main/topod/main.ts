import '../memory/host-malloc-tunables-claim'
import process from 'node:process'
import { main } from './topod-command-startup'
import { resolveTopodExitCode } from './topod-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runTopodNativePreflightVerdict } from './topod-native-preflight'
import {
  TOPOD_PROFILE_PREFLIGHT_FLAG,
  TOPOD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/topod-profile-preflight'
import { onNodePtyLoadFailure } from '../providers/node-pty-load-failure'
import {
  confirmBundledTopodStartupQualified,
  discardBundledTopodStartupQualification,
  forgetBundledTopodStartupQualification,
  preflightBundledTopodStartup,
  runTopodProfilePreflight
} from './topod-profile-preflight'
import { assertTopodServerRuntime } from './topod-bundled-runtime'
import {
  formatTopodNativePreflightReport,
  TOPOD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/topod-native-preflight-report'
import {
  TOPOD_CANCEL_MANAGED_STOP_FLAG,
  TOPOD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/topod-stop-request'
import {
  TOPOD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from '../../shared/windows-breakaway-launcher'
import { parseArgs } from './topod-command-arguments'
import { TOPOD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/topod-stale-lock-reclaim'

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--topod-smoke-load-check')) {
  process.exit(0)
}

function failStartup(error: unknown): void {
  console.error('topod: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveTopodExitCode(error))
}

// One-shot launch and stop commands must skip server startup and preflights.
if (process.argv[2] === '--topod-structured-provider-load-check') {
  void import('./topod-structured-provider-smoke')
    .then(({ smokeLoadTopodStructuredProviders }) => smokeLoadTopodStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(TOPOD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === TOPOD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === TOPOD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./topod-managed-stop-command').then(({ runTopodManagedStopCommandAndExit }) =>
    runTopodManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === TOPOD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./topod-stale-lock-reclaim').then(({ runTopodStaleLockReclaimCommandAndExit }) =>
    runTopodStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startTopodProcess()
}

function startTopodProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertTopodServerRuntime()
    const flag = process.argv[2]
    if (flag === TOPOD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatTopodNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === TOPOD_STARTUP_PREFLIGHT_FLAG && process.argv.length === 4) ||
      (flag === TOPOD_PROFILE_PREFLIGHT_FLAG &&
        (process.argv.length === 4 || process.argv.length === 5))
    ) {
      void runTopodProfilePreflight(process.argv[3], {
        nativeFeatures: flag === TOPOD_PROFILE_PREFLIGHT_FLAG,
        servedUserDataPath: process.argv[4]
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledTopodStartup()
        .then((qualified) => {
          onNodePtyLoadFailure(() => void discardBundledTopodStartupQualification())
          // Probe before deferred node-pty loading can crash this process; a slot qualified on this
          // unchanged host passed it on its last launch.
          if (runTopodNativePreflightVerdict({ qualified }) !== 'ok') {
            forgetBundledTopodStartupQualification()
          }
          return main()
        })
        .then(confirmBundledTopodStartupQualified)
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
