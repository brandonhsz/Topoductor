import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { HostAccountSignInStatus } from '../../shared/host-account-sign-in-types'

const SETTLED = new Set(['signedIn', 'failed', 'cancelled'])
// Above the host's 20s long poll, so an unchanged flow answers before we give up on it.
const WAIT_TIMEOUT_MS = 35_000

export const GITHUB_SIGN_IN_HANDLERS: Record<string, CommandHandler> = {
  'github login': async ({ client, json }) => {
    let response = await client.call<HostAccountSignInStatus>('github.hostSignInStart', {})
    let status = response.result
    let prompted = false
    const cancel = (): void => {
      void client
        .call('github.hostSignInCancel', { flowId: status.flowId })
        .finally(() => process.exit(130))
    }
    process.once('SIGINT', cancel)
    try {
      while (!SETTLED.has(status.phase)) {
        if (status.prompt && !prompted) {
          prompted = true
          // stderr keeps --json stdout to the final result.
          console.error(
            `Open ${status.prompt.url} and enter the code ${status.prompt.userCode ?? ''}\nWaiting for GitHub…`
          )
        }
        response = await client.call<HostAccountSignInStatus>(
          'github.hostSignInWait',
          { flowId: status.flowId, afterRevision: status.revision },
          { timeoutMs: WAIT_TIMEOUT_MS }
        )
        status = response.result
      }
    } finally {
      process.off('SIGINT', cancel)
    }
    if (status.phase !== 'signedIn') {
      throw new RuntimeClientError('runtime_error', status.error ?? 'GitHub sign-in was cancelled.')
    }
    printResult(
      { ...response, result: { login: status.github?.login ?? null } },
      json,
      ({ login }) => (login ? `Signed in to GitHub as ${login}.` : 'Signed in to GitHub.')
    )
  }
}
