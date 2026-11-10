// An update counts the server's terminals, then stops it: a terminal started between the two
// would die with the stop, uncounted. The last census closes admission so none can start.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import {
  TOPOD_UPDATE_ADMISSION_FENCE_MS,
  TopodTerminalCensusParamsSchema
} from '../../../../shared/topod-terminal-census'
import { spawnWorktreeTarget } from '../../../../shared/worktree/host-qualified-identity'
import { TOPOD_TERMINAL_CENSUS_METHODS } from '../../rpc/methods/topod/topod-terminal-census'
import { TERMINAL_UPDATE_ADMISSION_CLOSED_MESSAGE } from './terminal-update-admission'

const { collect, listLiveDaemonPtyIds } = vi.hoisted(() => ({
  collect: vi.fn(),
  listLiveDaemonPtyIds: vi.fn<() => Promise<string[] | null>>()
}))
vi.mock('../../../topod/topod-terminal-census', () => ({ collectTopodTerminalCensus: collect }))
vi.mock('../../../daemon/providers/lifecycle/daemon-provider-state', () => ({
  listLiveDaemonPtyIds
}))

// Fragments stay side-effect ordered: mocks, then lifecycle, then fixtures.
await import('../../topo-runtime-tests/runtime-test-module-registration.spec')
const { TopoRuntimeService } = await import('../../topo-runtime')
await import('../../topo-runtime-tests/topo-runtime-test-lifecycle.spec')
const { TEST_WORKTREE_ID, store } =
  await import('../../topo-runtime-tests/topo-runtime-test-fixtures.spec')

const idle = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 7 }
const target = spawnWorktreeTarget(TEST_WORKTREE_ID, null)

type CensusRequest = Omit<z.input<typeof TopodTerminalCensusParamsSchema>, 'activatedAt'>

function census(runtime: InstanceType<typeof TopoRuntimeService>, params: CensusRequest) {
  // Parsed as the server parses it, so a field the server does not know is dropped here too.
  const parsed = TopodTerminalCensusParamsSchema.parse({ activatedAt: 1, ...params })
  return TOPOD_TERMINAL_CENSUS_METHODS[0]!.handler(parsed, { runtime })
}

// What the SSH and WSL updates send as the last count before the stop.
const updateRecount: CensusRequest = {
  releaseFinishedAutomationTerminals: true,
  closeAdmissionForMs: TOPOD_UPDATE_ADMISSION_FENCE_MS
}

afterEach(() => {
  collect.mockReset()
  listLiveDaemonPtyIds.mockReset()
})

describe("an update's last terminal census", () => {
  it('counts only after a spawn admitted before it has finished starting', async () => {
    collect.mockResolvedValue({ ...idle, liveSessions: 1 })
    const runtime = new TopoRuntimeService(store)
    const releaseSpawn = await runtime.acquireWorktreeTerminalSpawn(target)

    const counted = census(runtime, updateRecount)
    await vi.waitFor(() => expect(runtime.terminalUpdateAdmission.isClosed()).toBe(true))
    expect(collect).not.toHaveBeenCalled()
    releaseSpawn()

    await expect(counted).resolves.toMatchObject({ liveSessions: 1 })
  })

  it('still lets a client reattach a session the daemon runs, but not one it cannot vouch for', async () => {
    collect.mockResolvedValue({ ...idle, liveSessions: 1 })
    const runtime = new TopoRuntimeService(store)
    await census(runtime, updateRecount)

    listLiveDaemonPtyIds.mockResolvedValue(['pty-live'])
    const requireAttachOnly = vi.fn()
    const release = await runtime.acquireWorktreeTerminalSpawn(target, {
      reattachSessionId: 'pty-live',
      requireAttachOnly
    })
    release()
    // Should the session exit before the attach lands, the spawn fails instead of starting one.
    expect(requireAttachOnly).toHaveBeenCalledTimes(1)
    listLiveDaemonPtyIds.mockResolvedValue(null)
    await expect(
      runtime.acquireWorktreeTerminalSpawn(target, { reattachSessionId: 'pty-live' })
    ).rejects.toThrow(TERMINAL_UPDATE_ADMISSION_CLOSED_MESSAGE)
  })
})
