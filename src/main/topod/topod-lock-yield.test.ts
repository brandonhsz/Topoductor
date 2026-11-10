import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./topod-browser-startup', () => ({
  startTopodBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { acquireTopodInstanceLock, TOPOD_LOCK_FILE_NAME } from './topod-instance-lock'
import { readTopodInstanceLockRecord } from './topod-instance-lock-record'
import { installTopodShutdownSignals, startTopodWithHost } from './topod-lifecycle'
import { TOPOD_LOCK_HEARTBEAT_MS } from './topod-lock-clone-machine'
import { topodRunFailed } from './topod-unexpected-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

const roots: string[] = []
afterEach(() => {
  // Drops the shutdown deadline timer so it cannot call the real process.exit later.
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

// Counting a yield as a crash would feed the supervisor's crash-loop brake.
it('yields a lost instance lock to its new holder without counting a failed run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'topod-lock-yield-'))
  roots.push(root)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.spyOn(process, 'on').mockImplementation(() => process)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the code; nothing after process.exit runs here.
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const handle = await startTopodWithHost(
    root,
    async () => ({}),
    () => {}
  )
  installTopodShutdownSignals(() => handle.stop())
  const lockPath = join(root, TOPOD_LOCK_FILE_NAME)
  rmSync(lockPath)
  const successor = acquireTopodInstanceLock(root)

  vi.advanceTimersByTime(TOPOD_LOCK_HEARTBEAT_MS)
  await vi.waitFor(
    () => expect(exit).toHaveBeenCalledWith(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE),
    { interval: 1 }
  )
  expect(topodRunFailed()).toBe(false)
  expect(readTopodInstanceLockRecord(lockPath)?.nonce).toBe(successor.record.nonce)
  successor.release()
})
