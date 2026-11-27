import type { HostAccountSignInProvider } from '../../../../../shared/host-account-sign-in-types'
import { HOST_ACCOUNT_SIGN_IN_RUNTIME_CAPABILITY } from '../../../../../shared/account-runtime-capabilities'
import { GITHUB_HOST_SIGN_IN_RUNTIME_CAPABILITY } from '../../../../../shared/source-control/runtime/source-control-runtime-capabilities'
import { CODEX_LOGIN_CANCELLED_MESSAGE } from '../../../../../shared/codex-auth-errors'

export const CANCELLED_MESSAGE: Record<HostAccountSignInProvider, string> = {
  claude: 'Claude sign-in was cancelled.',
  codex: CODEX_LOGIN_CANCELLED_MESSAGE,
  github: 'GitHub sign-in was cancelled.'
}
export const PROVIDER_LABEL: Record<HostAccountSignInProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  github: 'GitHub'
}

/** GitHub signs the host's own gh in, outside the managed-account queue. */
export const HOST_SIGN_IN_ROUTE: Record<
  HostAccountSignInProvider,
  { methods: string; capability: string; outdated: string }
> = {
  claude: accountRoute(),
  codex: accountRoute(),
  github: {
    methods: 'github.hostSignIn',
    capability: GITHUB_HOST_SIGN_IN_RUNTIME_CAPABILITY,
    outdated:
      'This server runs an older Topo that cannot sign in to GitHub from here. Update Topo on that server, or run `gh auth login` in a terminal there.'
  }
}

function accountRoute(): { methods: string; capability: string; outdated: string } {
  return {
    methods: 'accounts.hostSignIn',
    capability: HOST_ACCOUNT_SIGN_IN_RUNTIME_CAPABILITY,
    outdated:
      'This server runs an older Topo that cannot add accounts from here. Update Topo on that server, or run `topo account add` in a terminal there.'
  }
}
