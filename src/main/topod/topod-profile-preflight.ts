import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  TOPOD_STARTUP_PREFLIGHT_FLAG,
  TOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseTopodProfilePreflight,
  topodProfilePreflightResponseSchema,
  type TopodProfilePreflightResponse
} from '../../shared/topod-profile-preflight'
import { readTopodArtifactIdentity } from './topod-artifact-identity'
import { TOPOD_EXIT_CONFIGURATION } from './topod-configuration-exit'
import { TOPOD_SERVER_ENTRY_FILENAME, TOPOD_VERSION_FILENAME } from '../../shared/topod-artifacts'
import { TOPOD_NODE_RUNTIME_IDENTITY } from '../../shared/topod-node-runtime-identity'
import { runProcess } from '@topo/process-host'
import { preflightTopodNativeRuntime } from './topod-runtime-native-preflight'
import { topodCompileCacheEnv } from './topod-compile-cache'
import {
  consumeTopodStartupQualification,
  discardTopodStartupQualification,
  isQualifiableTopodSlot,
  topodStartupQualificationKey,
  recordTopodStartupQualification
} from './topod-startup-qualification'
import {
  isRunningAsBundledTopodRuntime,
  TopodBundledRuntimeError,
  resolveBundledTopodSlot
} from './topod-bundled-runtime'

let pendingQualification: { directory: string; key: string } | null = null
// The last marker write; recording fails open, so it never rejects.
let markerRecording: Promise<void> = Promise.resolve()

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledTopodStartup(): Promise<boolean> {
  const directory = resolveBundledTopodSlot()
  if (!isRunningAsBundledTopodRuntime(directory)) {
    return false
  }
  const identity = await readInstalledVersion(directory)
  // Windows' child also proves the process identity table, which depends on host services.
  const key =
    process.platform === 'win32' || !isQualifiableTopodSlot(directory)
      ? null
      : await topodStartupQualificationKey(directory, identity).catch(() => null)
  if (key && (await consumeTopodStartupQualification(directory, key))) {
    pendingQualification = { directory, key }
    return true
  }
  try {
    await runStartupPreflightChild(directory, identity)
  } catch (error) {
    if (key) {
      await discardTopodStartupQualification(directory)
    }
    throw error
  }
  pendingQualification = key ? { directory, key } : null
  return false
}

/** node-pty failed to load at spawn: the next launch must re-probe and report why. */
export async function discardBundledTopodStartupQualification(): Promise<void> {
  pendingQualification = null
  // A record still renaming its marker into place would recreate it after an earlier unlink.
  await markerRecording
  const directory = resolveBundledTopodSlot()
  if (process.platform !== 'win32' && isQualifiableTopodSlot(directory)) {
    await discardTopodStartupQualification(directory)
  }
}

/** A launch whose node-pty probe did not pass must not let the next one skip either probe. */
export function forgetBundledTopodStartupQualification(): void {
  pendingQualification = null
}

async function runStartupPreflightChild(directory: string, identity: string): Promise<void> {
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, TOPOD_SERVER_ENTRY_FILENAME), TOPOD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, TOPO_BACKGROUND_LAUNCH: '1', ...topodCompileCacheEnv(directory) },
    timeoutMs: TOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === TOPOD_EXIT_CONFIGURATION ? TopodBundledRuntimeError : Error
    throw new Failure(`The bundled Topo runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseTopodProfilePreflight(result.stdout, nonce, TOPOD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new TopodBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

/** Call once readiness is published: only a launch that got there lets the next one skip. */
export async function confirmBundledTopodStartupQualified(): Promise<void> {
  const qualified = pendingQualification
  pendingQualification = null
  if (qualified) {
    markerRecording = recordTopodStartupQualification(qualified.directory, qualified.key)
    await markerRecording
  }
}

export async function runTopodProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean; servedUserDataPath?: string } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledTopodSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readTopodArtifactIdentity(directory)
  } catch (cause) {
    throw new TopodBundledRuntimeError('The bundled Topo artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledTopodRuntime(directory)) {
    await preflightTopodNativeRuntime(options)
  }
  const response: TopodProfilePreflightResponse = {
    type: 'topo_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result,
    ...(options.servedUserDataPath === undefined
      ? {}
      : { liveDaemonProtocols: await readServedDaemonProtocols(options.servedUserDataPath) })
  }
  console.log(JSON.stringify(response))
}

/** The served data root, never this probe's own, decides which daemons a restart must reach. */
async function readServedDaemonProtocols(servedUserDataPath: string): Promise<number[] | null> {
  // A failed probe leaves the crossing unverifiable; it must not fail the candidate itself.
  try {
    // Import lazily: startup preflight loads this module and needs no daemon code.
    const [{ listLiveDaemonProtocols }, { daemonRuntimeDirFor }, protocol] = await Promise.all([
      import('../daemon/launch/daemon-generation-liveness'),
      import('../daemon/endpoint/publication/daemon-runtime-dir'),
      import('../daemon/protocol/daemon-protocol-version')
    ])
    return await listLiveDaemonProtocols(daemonRuntimeDirFor(servedUserDataPath), [
      protocol.PROTOCOL_VERSION,
      ...protocol.PREVIOUS_DAEMON_PROTOCOL_VERSIONS
    ])
  } catch {
    return null
  }
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return topodProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, TOPOD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new TopodBundledRuntimeError(
      'The installed Topo artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
