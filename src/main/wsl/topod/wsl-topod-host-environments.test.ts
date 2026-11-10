import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  observeWslTopodHostResponse,
  onWslTopodHostAutomationsChanged,
  registerWslTopodHostEnvironment,
  unregisterWslTopodHostEnvironment,
  wslTopodHostSupports
} from './wsl-topod-host-environments'

const CAPABILITY = 'agent-session.account-env.v1'

function status(capabilities: string[]): RuntimeRpcResponse<unknown> {
  return { id: 'status.get', ok: true, result: { capabilities }, _meta: { runtimeId: 'r' } }
}

describe('wslTopodHostSupports', () => {
  afterEach(() => unregisterWslTopodHostEnvironment('env-1', 'Ubuntu'))

  it('asks the host once, then answers from what it reported', async () => {
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslTopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    await expect(wslTopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    expect(readStatus).toHaveBeenCalledTimes(1)
  })

  it('reports an older host as unsupported and a failed probe as unknown', async () => {
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    await expect(wslTopodHostSupports('env-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unsupported'
    )
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    await expect(
      wslTopodHostSupports('env-1', CAPABILITY, async () => {
        throw new Error('offline')
      })
    ).resolves.toBe('unknown')
    const failure: RuntimeRpcResponse<unknown> = {
      id: 'status.get',
      ok: false,
      error: { code: 'x', message: 'x' }
    }
    await expect(wslTopodHostSupports('env-1', CAPABILITY, async () => failure)).resolves.toBe(
      'unknown'
    )
  })

  it("follows a renderer's status.get and forgets it on reconnect", async () => {
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    observeWslTopodHostResponse('env-1', 'status.get', status([]))
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslTopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    observeWslTopodHostResponse('env-1', 'terminal.list', status([CAPABILITY]))
    await expect(wslTopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    // A reconnect may be a redeployed topod.
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    await expect(wslTopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
  })

  it('records nothing for an environment that is not a WSL topod', async () => {
    observeWslTopodHostResponse('ssh-1', 'status.get', status([CAPABILITY]))
    await expect(wslTopodHostSupports('ssh-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unknown'
    )
  })
})

describe('onWslTopodHostAutomationsChanged (E9)', () => {
  afterEach(() => unregisterWslTopodHostEnvironment('env-1', 'Ubuntu'))

  it('tells the wake schedule when this desktop changed a WSL host’s automations', () => {
    registerWslTopodHostEnvironment('env-1', 'Ubuntu')
    const listener = vi.fn()
    const stop = onWslTopodHostAutomationsChanged(listener)
    const ok = (id: string): RuntimeRpcResponse<unknown> => ({
      id,
      ok: true,
      result: {},
      _meta: { runtimeId: 'r' }
    })
    observeWslTopodHostResponse('env-1', 'automation.delete', ok('automation.delete'))
    observeWslTopodHostResponse('env-1', 'automation.update', ok('automation.update'))
    observeWslTopodHostResponse('env-1', 'automation.list', ok('automation.list'))
    observeWslTopodHostResponse('ssh-box', 'automation.create', ok('automation.create'))
    expect(listener.mock.calls).toEqual([['env-1'], ['env-1']])
    stop()
  })
})
