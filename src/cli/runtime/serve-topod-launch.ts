/** The app selects the local serve runtime; the CLI runs that selection. */
import { dirname, join } from 'node:path'
import { runProcess, spawnProcess } from '@topo/process-host'
import type { ProcessSpec } from '@topo/process-host/process-spec'
import {
  TOPOD_LOCAL_SERVE_SELECTION_ENTRY,
  TOPOD_LOCAL_SERVE_SELECTION_FLAGS as FLAGS,
  SERVE_RUNTIME_ENV,
  parseServeRuntimeSelection,
  type ServeRuntimeSelection
} from '../../shared/topod-local-serve-selection'
import { waitForRecipeJson } from './serve-recipe-json'
import { superviseForegroundServe } from './serve-update-supervisor'
import { isSupervisedSpawnHeld } from './serve-supervised-stop'
import { redactingSpawn, shouldRedactSupervisedStdout } from './serve-pairing-redaction'
import { topodServeArgs, type ServeTopoAppArgs } from '../../shared/topod-serve-argv'
import { SPEECH_RECOGNIZER_DIR_ENV } from '../../shared/speech-recognizer-package'
import { TOPO_SERVE_SUPERVISED_ENV } from '../../shared/serve-supervised-terminal-durability'

/** A first run may download and verify the pinned Node; bound it well past that. */
const SELECTION_TIMEOUT_MS = 10 * 60_000

export async function resolveLocalServeRuntime(
  options: {
    executable: string
    appRoot: string
    userDataPath: string
    usesMacUpdateHandoff: boolean
    env?: NodeJS.ProcessEnv
  },
  run: typeof runProcess = runProcess
): Promise<ServeRuntimeSelection> {
  // topod has no updater; keep Electron for packaged macOS update handoffs unless topod is asked for,
  // e.g. over SSH with no desktop login, where Electron cannot start.
  if (options.usesMacUpdateHandoff && (options.env ?? process.env)[SERVE_RUNTIME_ENV] !== 'topod') {
    return {
      kind: 'electron',
      reason:
        'packaged macOS serve stays on Electron so paired clients can still update it (topod has no app updater)'
    }
  }
  const entry = join(options.appRoot, 'out', 'main', `${TOPOD_LOCAL_SERVE_SELECTION_ENTRY}.js`)
  try {
    const result = await run({
      program: options.executable,
      args: [entry, FLAGS.userData, options.userDataPath, FLAGS.appRoot, options.appRoot],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // Show pinned-Node download progress so first-run selection does not appear hung.
      stdio: ['ignore', 'pipe', 'inherit'],
      timeoutMs: SELECTION_TIMEOUT_MS
    })
    return (
      parseServeRuntimeSelection(result.stdout) ?? {
        kind: 'electron',
        reason: `the app did not answer which serve host to use (exit ${String(result.code)})`
      }
    )
  } catch (error) {
    return {
      kind: 'electron',
      reason: `the app could not check topod: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** Electron serve binds every interface (`exposeNetworkByDefault`); topod does it on request. */
export function serveWithTopod(
  selection: Extract<ServeRuntimeSelection, { kind: 'topod' }>,
  args: ServeTopoAppArgs,
  userDataPath: string,
  /** The caller's environment without `ELECTRON_RUN_AS_NODE`. */
  baseEnv: NodeJS.ProcessEnv,
  /** The app's browser client; the slot does not carry one, so topod serves it from here. */
  webClientRoot?: string,
  /** topod’s slot has no speech recognizer; use the app’s copy. */
  speechRecognizerDir?: string
): Promise<number> {
  const spec: ProcessSpec = {
    program: selection.runtime,
    args: [selection.entry, ...topodServeArgs(args, webClientRoot)],
    detached: args.recipeJson === true,
    cwd: dirname(selection.entry),
    stdio: args.recipeJson === true ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: {
      ...baseEnv,
      // The desktop's profile: its instance lock makes the two refuse each other.
      TOPO_USER_DATA: userDataPath,
      TOPO_VERSION: selection.version,
      // Always set: a value inherited from a Topo terminal would name another install's copy.
      [SPEECH_RECOGNIZER_DIR_ENV]: speechRecognizerDir ?? '',
      // A service manager restarts this server, so it must not run terminals that die with it.
      [TOPO_SERVE_SUPERVISED_ENV]: args.supervise === true ? '1' : ''
    }
  }
  const spawnChild = shouldRedactSupervisedStdout(args.supervise === true)
    ? redactingSpawn(spawnProcess)
    : spawnProcess
  if (isSupervisedSpawnHeld()) {
    return Promise.resolve(0)
  }
  const child = spawnChild(spec)
  if (args.recipeJson) {
    return waitForRecipeJson(child)
  }
  return superviseForegroundServe({
    spec,
    spawnChild,
    child,
    handoffPath: null,
    expectedHandoff: null
  })
}
