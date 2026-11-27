import { defineMethod, type RpcContext } from '../../../core'
import { rpcCallerOperationKey } from '../../../rpc-caller-identity'
import { HostAccountSignInFlows } from '../../../../agent-session/environment/host-account-sign-in-flows'
import type { TopoRuntimeService } from '../../../../topo-runtime'
import { runGhDeviceLogin } from '../../../../../github/gh-device-login'
import {
  GitHubHostSignInStartParams,
  HostAccountSignInFlowParams,
  HostAccountSignInWaitParams
} from '../../../../../../shared/rpc-contract/accounts-params'

// Why its own queue: a GitHub login must not block, or be blocked by, a Claude/Codex sign-in.
const flowsByRuntime = new WeakMap<TopoRuntimeService, HostAccountSignInFlows>()
function githubSignInFlows(runtime: TopoRuntimeService): HostAccountSignInFlows {
  let flows = flowsByRuntime.get(runtime)
  if (!flows) {
    flows = new HostAccountSignInFlows(async (_provider, channel) => ({
      github: await runGhDeviceLogin(channel)
    }))
    flowsByRuntime.set(runtime, flows)
  }
  return flows
}

function signInOwner({ caller }: Pick<RpcContext, 'caller'>): string {
  if (!caller) {
    throw new Error('This client cannot sign in to GitHub on this host.')
  }
  return rpcCallerOperationKey(caller)
}

// The token stays in this host's gh keyring; the caller only opens github.com/login/device.
export const GITHUB_HOST_SIGN_IN_METHODS = [
  defineMethod({
    name: 'github.hostSignInStart',
    permission: 'accounts-admin',
    params: GitHubHostSignInStartParams,
    handler: async (_params, ctx) =>
      githubSignInFlows(ctx.runtime).start(signInOwner(ctx), 'github')
  }),
  defineMethod({
    name: 'github.hostSignInWait',
    permission: 'accounts-admin',
    params: HostAccountSignInWaitParams,
    handler: async ({ flowId, afterRevision }, ctx) =>
      githubSignInFlows(ctx.runtime).wait(signInOwner(ctx), flowId, afterRevision, ctx.signal)
  }),
  defineMethod({
    name: 'github.hostSignInCancel',
    permission: 'accounts-admin',
    params: HostAccountSignInFlowParams,
    handler: async ({ flowId }, ctx) =>
      githubSignInFlows(ctx.runtime).cancel(signInOwner(ctx), flowId)
  })
]
