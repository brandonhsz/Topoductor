// SSH channel closure does not prove host mutation exit; only command output or exit may release the activation fence.
import { TOPOD_STATE_MUTATION_DEADLINE_SECONDS } from './topod-state-snapshot'
import {
  TOPOD_STATE_MUTATION_BUSY,
  TOPOD_STATE_MUTATION_DEADLINE
} from './topod-state-snapshot-members'
import type { TopodRemoteExecTarget } from '../install/topod-remote-runtime-control'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { isTopodFenceLost, TopodFenceLostError } from '../activation/topod-activation-fence-scope'

// Let the host deadline kill workload before client observation times out.
export const TOPOD_STATE_MUTATION_CLIENT_TIMEOUT_MS =
  (TOPOD_STATE_MUTATION_DEADLINE_SECONDS + 60) * 1000

function unconfirmed(error: Error): Error & { sshChannelCloseConfirmed: false } {
  return Object.assign(error, { sshChannelCloseConfirmed: false as const })
}

/** Do not abort observation: caller cancellation cannot stop host-side mutation. */
export async function execTopodStateMutation(
  target: TopodRemoteExecTarget,
  command: string
): Promise<string> {
  let output: string
  try {
    output = await execCommand(target.conn, command, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: TOPOD_STATE_MUTATION_CLIENT_TIMEOUT_MS
    })
  } catch (error) {
    // Channel termination flags uncertainty; exit-status errors prove completion.
    if (error instanceof Error && 'sshChannelCloseConfirmed' in error) {
      throw unconfirmed(error)
    }
    throw isTopodFenceLost(error) ? new TopodFenceLostError() : error
  }
  const verdict = output.trim().split('\n').pop()?.trim()
  if (verdict === TOPOD_STATE_MUTATION_BUSY) {
    throw unconfirmed(
      new Error('Another snapshot capture or restore is still running on the host.')
    )
  }
  if (verdict === TOPOD_STATE_MUTATION_DEADLINE) {
    throw unconfirmed(
      new Error(
        `A snapshot capture or restore ran past ${TOPOD_STATE_MUTATION_DEADLINE_SECONDS}s and ` +
          'the host stopped it part way through.'
      )
    )
  }
  return output
}

/** Fall back only for finished failures; unconfirmed mutation remains fenced. */
export function execTopodStateMutationOr(
  target: TopodRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execTopodStateMutation(target, command).catch((error: unknown) => {
    // Lost ownership is a refusal, never a capture failure eligible for fallback.
    if (isUnconfirmedSshCommandTermination(error) || error instanceof TopodFenceLostError) {
      throw error
    }
    return fallback
  })
}
