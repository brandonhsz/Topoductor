import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopoCloudSignInProgress } from '../../../../shared/topo-profiles'
import { createTestStore } from '../../store/testing/app-store-test-fixture'

type TestStore = ReturnType<typeof createTestStore>

const { storeHolder } = vi.hoisted((): { storeHolder: { current: TestStore | null } } => ({
  storeHolder: { current: null }
}))

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => storeHolder.current?.getState(),
    setState: (partial: { topoProfileSignInProgress: TopoCloudSignInProgress | null }) =>
      storeHolder.current?.setState(partial)
  }
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

import { registerTopoProfileAuthIpcBridge } from './topo-profile-auth-ipc-bridge'

describe('topo profile sign-in progress IPC bridge', () => {
  let emitProgress: (progress: TopoCloudSignInProgress | null) => void
  const snapshots: ((progress: TopoCloudSignInProgress | null) => void)[] = []
  const WAITING = { link: 'https://login.example/authorize?state=a' }

  beforeEach(() => {
    snapshots.length = 0
    storeHolder.current = createTestStore()
    vi.stubGlobal('window', {
      api: {
        topoProfiles: {
          onSignInProgressChanged: (
            callback: (progress: TopoCloudSignInProgress | null) => void
          ) => {
            emitProgress = callback
            return () => {}
          },
          signInProgress: () =>
            new Promise<TopoCloudSignInProgress | null>((resolve) => {
              snapshots.push(resolve)
            })
        }
      }
    })
  })

  const progress = (): TopoCloudSignInProgress | null =>
    storeHolder.current?.getState().topoProfileSignInProgress ?? null

  it('lets a newer change win over a late snapshot', async () => {
    registerTopoProfileAuthIpcBridge([])
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    emitProgress(null)
    snapshots[0](WAITING)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(progress()).toBeNull()
  })
})
