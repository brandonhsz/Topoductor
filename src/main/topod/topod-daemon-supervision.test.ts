import { afterEach, describe, expect, it, vi } from 'vitest'

const initDaemonPtyProvider = vi.hoisted(() => vi.fn())
vi.mock('../daemon/providers/lifecycle/daemon-provider-init', () => ({ initDaemonPtyProvider }))

import { startTopodDaemon } from './topod-daemon-supervision'
import { TopodTerminalsNotDurableError } from './topod-serve-supervision'
import { resolveTopodExitCode } from './topod-exit-code'
import {
  TOPO_SERVE_SUPERVISED_ENV,
  TOPOD_EXIT_TERMINALS_NOT_DURABLE
} from '../../shared/serve-supervised-terminal-durability'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env[TOPO_SERVE_SUPERVISED_ENV]
})

describe('startTopodDaemon', () => {
  it('refuses to serve a supervised host whose terminals would die with it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initDaemonPtyProvider.mockRejectedValue(new Error('daemon health check rejected'))

    process.env[TOPO_SERVE_SUPERVISED_ENV] = '1'
    const supervised = startTopodDaemon('linux')
    await expect(supervised).rejects.toBeInstanceOf(TopodTerminalsNotDurableError)
    const error = await supervised.catch((caught: unknown) => caught)
    expect(resolveTopodExitCode(error)).toBe(TOPOD_EXIT_TERMINALS_NOT_DURABLE)
    expect(String(error)).toContain('daemon health check rejected')
    expect(process.env[TOPO_SERVE_SUPERVISED_ENV]).toBeUndefined()

    await expect(startTopodDaemon('linux')).resolves.toMatchObject({
      state: 'unavailable'
    })
  })
})
