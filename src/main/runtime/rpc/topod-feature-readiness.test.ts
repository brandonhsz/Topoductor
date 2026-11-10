import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installTopodFeatureReadiness,
  TOPOD_FEATURES,
  rpcMethodFeatureWait
} from './topod-feature-readiness'

// No local readiness reset: the shared vitest setup must restore it (asserted below).
afterEach(() => {
  vi.useRealTimers()
})

describe('TopodFeatureReadiness', () => {
  it('adds no await for open or undeclared features, so ungated dispatch starts synchronously', () => {
    expect(rpcMethodFeatureWait([])).toBeNull()
    expect(rpcMethodFeatureWait(['accounts'])).toBeNull()
    const readiness = installTopodFeatureReadiness()
    expect(rpcMethodFeatureWait([])).toBeNull()
    readiness.open('accounts')
    expect(rpcMethodFeatureWait(['accounts'])).toBeNull()
  })

  it('starts with every feature closed under topod and waits for all a method names', async () => {
    const readiness = installTopodFeatureReadiness()
    expect(TOPOD_FEATURES.every((feature) => !readiness.isOpen(feature))).toBe(true)
    let settled = false
    const wait = rpcMethodFeatureWait(['accounts', 'orchestration'])?.then(() => {
      settled = true
    })
    readiness.open('accounts')
    await Promise.resolve()
    expect(settled).toBe(false)
    readiness.open('orchestration')
    await wait
    expect(settled).toBe(true)
  })

  it('refuses with runtime_unavailable after the bound and leaves no timer behind', async () => {
    vi.useFakeTimers()
    installTopodFeatureReadiness()
    const wait = rpcMethodFeatureWait(['sessionSearch'], [], 50)
    const refused = expect(wait).rejects.toThrow('runtime_unavailable')
    await vi.advanceTimersByTimeAsync(50)
    await refused
    expect(vi.getTimerCount()).toBe(0)
  })

  // The shared setup resets after every test; these two run in order in one worker.
  it('may leave latches closed when a test stops partway', () => {
    installTopodFeatureReadiness()
    expect(rpcMethodFeatureWait(['accounts'])).not.toBeNull()
  })

  it('finds every latch open again in the next test', () => {
    expect(rpcMethodFeatureWait(['accounts'])).toBeNull()
  })
})
