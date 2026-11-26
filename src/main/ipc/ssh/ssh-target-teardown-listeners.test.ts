import { describe, expect, it } from 'vitest'
import {
  onSshShutdown,
  onSshTargetTeardown,
  runSshShutdownListeners,
  runSshTargetTeardownListeners
} from './ssh-target-teardown-listeners'

describe('SSH teardown listeners', () => {
  it('tells each subscriber which target is torn down until it unsubscribes', async () => {
    const seen: string[] = []
    const off = onSshTargetTeardown(async (targetId) => {
      seen.push(targetId)
    })

    await runSshTargetTeardownListeners('box-1')
    off()
    await runSshTargetTeardownListeners('box-2')

    expect(seen).toEqual(['box-1'])
  })

  it('waits for shutdown subscribers to finish', async () => {
    let finished = false
    const off = onSshShutdown(async () => {
      await Promise.resolve()
      finished = true
    })

    await runSshShutdownListeners()
    off()

    expect(finished).toBe(true)
  })
})
