import { evaluateTopodActivation, type TopodActivationExpectation } from './topod-activation-gate'
import {
  topodLivenessProbeCommand,
  parseTopodLiveness,
  type TopodLaunchSpec,
  type TopodReadinessParse
} from '../install/topod-remote-launch'
import {
  execTopodRemote,
  launchTopodAndAwaitReadiness,
  type TopodRemoteExecTarget
} from '../install/topod-remote-runtime-control'
import {
  parseTopodReadinessWaitOutput,
  readTopodReadinessNowCommand
} from '../install/topod-remote-readiness-wait'
import type { ServeReadiness } from '../../server/serve-readiness'
import { withTopodLogTail } from '../install/topod-remote-log-tail'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

type TopodReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class TopodActiveReadinessError extends Error {
  constructor(
    readonly verdict: TopodReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'TopodActiveReadinessError'
  }
}

/** A launched topod that did not publish acceptable readiness; inspection failures stay the base error. */
export class TopodLaunchReadinessError extends TopodActiveReadinessError {
  constructor(verdict: TopodReadinessFailureVerdict, message: string) {
    super(verdict, message)
    this.name = 'TopodLaunchReadinessError'
  }
}

function gatedReadiness(
  parsed: TopodReadinessParse,
  expectation: TopodActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateTopodActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new TopodActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new TopodActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = topodDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new TopodActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function topodDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveTopodReadiness(
  target: TopodRemoteExecTarget & { remoteInstallDir: string },
  expectation: TopodActivationExpectation
): Promise<ServeReadiness> {
  assertActiveTopodLive(
    await execTopodRemote(target, topodLivenessProbeCommand(target.host, target.remoteInstallDir)),
    expectation
  )
  return activeTopodReadinessFromOutput(
    target.host,
    await execTopodRemote(
      target,
      readTopodReadinessNowCommand(target.host, target.remoteInstallDir)
    ),
    expectation
  )
}

/** Throws unless the liveness probe's answer proves the active slot's process is running. */
export function assertActiveTopodLive(
  livenessOutput: string,
  expectation: TopodActivationExpectation
): void {
  const liveness = parseTopodLiveness(livenessOutput)
  if (liveness === 'DEAD') {
    throw new TopodActiveReadinessError(
      'exited',
      `topod ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new TopodActiveReadinessError(
      'exited',
      `topod ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new TopodActiveReadinessError(
      'unverifiable',
      `topod ${expectation.fullVersion} process state is unverifiable.`
    )
  }
}

export function activeTopodReadinessFromOutput(
  host: RemoteHostPlatform,
  readinessOutput: string,
  expectation: TopodActivationExpectation
): ServeReadiness {
  return gatedReadiness(
    parseTopodReadinessWaitOutput(host, readinessOutput),
    expectation,
    'The active topod'
  )
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchTopodSlotAndAwaitReadiness(
  target: TopodRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: TopodLaunchSpec,
  expectation: TopodActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchTopodAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `topod ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof TopodActiveReadinessError)) {
      throw error
    }
    const message = await withTopodLogTail(target, spec.remoteInstallDir, error.message)
    throw new TopodLaunchReadinessError(error.verdict, message)
  }
}
