import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { HostAccountSignInChannel } from '../../shared/host-account-sign-in-types'
import {
  parseGhDeviceLoginPrompt,
  runGhDeviceLogin,
  type GhDeviceLoginDeps
} from './gh-device-login'

vi.mock('../ipc/preflight-command-exec', () => ({}))
vi.mock('../ipc/preflight-local-env', () => ({}))
vi.mock('../preflight/agent-detection', () => ({}))
vi.mock('../git/git-username', () => ({}))

// Verbatim gh 2.105 stderr when stdin is not a terminal.
const GH_2_105 =
  '! One-time code (EDAF-64FC) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device\n'
const GH_OLDER =
  '! First copy your one-time code: 1A2B-3C4D\nPress Enter to open https://github.com/login/device in your browser...\n'

describe('parseGhDeviceLoginPrompt', () => {
  it.each([
    [GH_2_105, 'EDAF-64FC'],
    [GH_OLDER, '1A2B-3C4D']
  ])('reads the code and device page from gh output', (output, userCode) => {
    expect(parseGhDeviceLoginPrompt(output)).toEqual({
      url: 'https://github.com/login/device',
      userCode
    })
  })

  it('waits until both the code and the page arrived', () => {
    expect(parseGhDeviceLoginPrompt('! One-time code (EDAF-64FC) copied to clipboard\n')).toBeNull()
  })
})

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn()
  })
}

function setup(): {
  deps: GhDeviceLoginDeps
  child: ReturnType<typeof fakeChild>
  channel: HostAccountSignInChannel
  abort: AbortController
} {
  const child = fakeChild()
  const abort = new AbortController()
  const deps: GhDeviceLoginDeps = {
    findGh: async () => '/opt/homebrew/bin/gh',
    spawnLogin: vi.fn(() => child),
    run: vi.fn(async (_binary: string, args: string[]) => (args[0] === 'api' ? 'octo\n' : '')),
    env: () => ({ PATH: '/usr/bin', GH_TOKEN: 'stale', GITHUB_TOKEN: 'stale' }),
    onSignedIn: vi.fn()
  }
  const channel: HostAccountSignInChannel = {
    signal: abort.signal,
    onPrompt: vi.fn(),
    nextCode: () => Promise.reject(new Error('unused'))
  }
  return { deps, child, channel, abort }
}

describe('runGhDeviceLogin', () => {
  it('relays the device code, then wires git credentials and reports the login', async () => {
    const { deps, child, channel } = setup()
    const done = runGhDeviceLogin(channel, deps)
    await vi.waitFor(() => expect(deps.spawnLogin).toHaveBeenCalled())
    child.stderr.emit('data', Buffer.from(GH_2_105))
    child.emit('close', 0)

    await expect(done).resolves.toEqual({ login: 'octo' })
    expect(channel.onPrompt).toHaveBeenCalledWith({
      url: 'https://github.com/login/device',
      userCode: 'EDAF-64FC',
      needsCode: false
    })
    const env = vi.mocked(deps.spawnLogin).mock.calls[0][2]
    expect(env).not.toHaveProperty('GH_TOKEN')
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
    expect(vi.mocked(deps.run).mock.calls.map((call) => call[1].slice(0, 2))).toEqual([
      ['auth', 'setup-git'],
      ['api', 'user']
    ])
    expect(deps.onSignedIn).toHaveBeenCalled()
  })

  it('kills the login and rejects when the flow is cancelled', async () => {
    const { deps, child, channel, abort } = setup()
    const done = runGhDeviceLogin(channel, deps)
    await vi.waitFor(() => expect(deps.spawnLogin).toHaveBeenCalled())
    abort.abort()

    await expect(done).rejects.toThrow('GitHub sign-in was cancelled.')
    expect(child.kill).toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('fails with gh output when the login exits nonzero', async () => {
    const { deps, child, channel } = setup()
    const done = runGhDeviceLogin(channel, deps)
    await vi.waitFor(() => expect(deps.spawnLogin).toHaveBeenCalled())
    child.stderr.emit('data', Buffer.from('error: authorization denied\n'))
    child.emit('close', 1)

    await expect(done).rejects.toThrow('gh auth login failed: error: authorization denied')
  })

  it('explains when gh is missing on the host', async () => {
    const { deps, channel } = setup()
    deps.findGh = async () => null
    await expect(runGhDeviceLogin(channel, deps)).rejects.toThrow(
      'GitHub CLI (gh) is not installed'
    )
  })
})
