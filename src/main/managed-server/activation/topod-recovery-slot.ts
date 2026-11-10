/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../../server/serve-readiness'
import type { TopodActivationExpectation } from './topod-activation-gate'
import { TOPOD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import { readRemoteTopodBuildHash } from '../install/topod-remote-build-hash'
import {
  launchTopodSlotAndAwaitReadiness,
  TopodActiveReadinessError,
  probeActiveTopodReadiness
} from './topod-active-readiness'
import {
  topodLivenessProbeCommand,
  topodLivenessProvenExited,
  parseTopodLiveness,
  type TopodLiveness
} from '../install/topod-remote-launch'
import {
  parseTopodStopOutcome,
  stopTopodCommand,
  type TopodStopOutcome
} from '../install/topod-remote-process-control'
import {
  execTopodRemote,
  type TopodRemoteExecTarget
} from '../install/topod-remote-runtime-control'
import { topodActivationTransactionRoot } from './topod-activation-transaction'
import {
  initialTopodActivationAdmissionCommand,
  parseInitialTopodActivationAdmission
} from './topod-initial-activation-admission'

export const TOPOD_SLOT_STOP_WAIT_SECONDS = 20

export type TopodSlotOptions = TopodRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type TopodSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: TopodSlotIdentity): TopodActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function topodSlotDir(options: TopodSlotOptions, version: string): string {
  return computeRemoteInstallDir(TOPOD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveTopodSlotIdentity(
  options: TopodSlotOptions,
  version: string
): Promise<TopodSlotIdentity> {
  const remoteDir = topodSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteTopodBuildHash(options, remoteDir) }
}

export function launchTopodSlot(
  options: TopodSlotOptions,
  identity: TopodSlotIdentity
): Promise<ServeReadiness> {
  return launchTopodSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: topodActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureTopodSlotServing(
  options: TopodSlotOptions,
  identity: TopodSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseTopodLiveness(
    await execTopodRemote(options, topodLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveTopodReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!topodLivenessProvenExited(liveness)) {
    throw new TopodActiveReadinessError(
      'unverifiable',
      `topod ${identity.version} process state is unverifiable.`
    )
  }
  return launchTopodSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopTopodSlot(
  options: TopodSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<TopodStopOutcome> {
  return parseTopodStopOutcome(
    await execTopodRemote(
      options,
      stopTopodCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: TOPOD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: TOPOD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type TopodSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedTopodSlot(
  options: TopodSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: TopodSlotIdentity | null
): Promise<TopodSlotQuiescence> {
  const remoteDir = version === null ? null : topodSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopTopodSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = topodLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveTopodReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!topodLivenessProvenExited(other)) {
      throw new TopodActiveReadinessError(
        'unverifiable',
        `topod ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialTopodActivationAdmission(
      await execTopodRemote(
        options,
        initialTopodActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new TopodActiveReadinessError(
      'unverifiable',
      `topod ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: TopodSlotOptions,
  remoteDir: string
): Promise<TopodLiveness> {
  return parseTopodLiveness(
    await execTopodRemote(options, topodLivenessProbeCommand(options.host, remoteDir))
  )
}
