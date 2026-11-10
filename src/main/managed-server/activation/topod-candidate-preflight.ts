import { errorMessage } from '../../../shared/error-message'
import { preflightInstalledTopod } from '../install/topod-remote-preflight'

/** Preflight before any stop; asked to, the candidate also names the daemon generations under the served data root. */
export async function preflightTopodCandidate(
  options: Omit<Parameters<typeof preflightInstalledTopod>[0], 'probeDaemonsUnder'> & {
    userDataDir: string
  },
  probeDaemons: boolean
): Promise<{ hostDaemonProtocols: readonly number[] | undefined } | { failure: string }> {
  try {
    const answer = await preflightInstalledTopod({
      ...options,
      ...(probeDaemons ? { probeDaemonsUnder: options.userDataDir } : {})
    })
    return { hostDaemonProtocols: answer.liveDaemonProtocols ?? undefined }
  } catch (error) {
    options.signal?.throwIfAborted()
    return {
      failure: `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    }
  }
}
