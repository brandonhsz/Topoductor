import { evaluateTopodActivation, type TopodActivationVerdict } from './topod-activation-gate'
import { topodActivationTransactionRoot } from './topod-activation-transaction'
import type { TopodReadinessParse } from '../install/topod-remote-launch'
import {
  launchTopodAndAwaitReadiness,
  type TopodRemoteExecTarget
} from '../install/topod-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchTopodAndAwaitReadiness>[0] &
  TopodRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeTopodSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: TopodActivationVerdict; launchError: unknown }> {
  let parsed: TopodReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchTopodAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: topodActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateTopodActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
