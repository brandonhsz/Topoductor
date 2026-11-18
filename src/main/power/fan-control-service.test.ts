import { describe, expect, it, vi, type Mock } from 'vitest'
import type { FanControlStatus } from '../../shared/fan-control-contract'
import { FanControlService, type FanControlServiceDeps } from './fan-control-service'

const HELPER = '/Applications/Topo.app/Contents/MacOS/topo-fan-control'
const LEASE = '/Users/me/Library/Application Support/topo/fan-control.lease'
const TWO_FANS = JSON.stringify({
  mode: 'auto',
  fans: [
    { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 },
    { index: 1, rpm: 2500, minRpm: 2317, maxRpm: 6800 }
  ]
})

type RunHelper = FanControlServiceDeps['runHelper']
type RunPrivileged = FanControlServiceDeps['runPrivileged']
type SupportedStatus = Extract<FanControlStatus, { supported: true }>

type Harness = {
  service: FanControlService
  deps: FanControlServiceDeps
  files: Map<string, string>
  runPrivileged: Mock<RunPrivileged>
  runHelper: Mock<RunHelper>
}

type HarnessOverrides = Partial<Omit<FanControlServiceDeps, 'runHelper' | 'runPrivileged'>> & {
  runHelper?: Mock<RunHelper>
  runPrivileged?: (files: Map<string, string>) => Mock<RunPrivileged>
}

function createHarness(overrides: HarnessOverrides = {}): Harness {
  const files = new Map<string, string>()
  const { runHelper: helperOverride, runPrivileged: privilegedOverride, ...rest } = overrides
  const runHelper =
    helperOverride ?? vi.fn<RunHelper>(async () => ({ code: 0, stdout: TWO_FANS, stderr: '' }))
  // The real hold rewrites the lease to 'ready' once both fans are forced.
  const runPrivileged =
    privilegedOverride?.(files) ??
    vi.fn<RunPrivileged>(async () => {
      files.set(LEASE, 'ready')
    })
  const deps: FanControlServiceDeps = {
    platform: 'darwin',
    helperPath: HELPER,
    leasePath: LEASE,
    pid: 4242,
    runHelper,
    runPrivileged,
    fs: {
      writeFile: async (path, data) => {
        files.set(path, data)
      },
      readFile: async (path) => files.get(path) ?? null,
      rm: async (path) => {
        files.delete(path)
      },
      rmSync: (path) => {
        files.delete(path)
      }
    },
    sleep: async () => {},
    readyTimeoutMs: 50,
    ...rest
  }
  return { service: new FanControlService(deps), deps, files, runPrivileged, runHelper }
}

function expectSupported(status: FanControlStatus): SupportedStatus {
  if (!status.supported) {
    throw new Error(`expected a supported status, got ${status.reason}`)
  }
  return status
}

describe('FanControlService support detection', () => {
  it.each(['linux', 'win32'] as const)(
    'reports not-macos on %s without running the helper',
    async (platform) => {
      const { service, runHelper } = createHarness({ platform })
      expect(await service.getStatus()).toEqual({ supported: false, reason: 'not-macos' })
      expect(runHelper).not.toHaveBeenCalled()
    }
  )

  it('reports helper-missing when the bundled helper is absent', async () => {
    const { service } = createHarness({ helperPath: null })
    expect(await service.getStatus()).toEqual({ supported: false, reason: 'helper-missing' })
  })

  it('reports no-fans for fanless Macs', async () => {
    const { service } = createHarness({
      runHelper: vi.fn<RunHelper>(async () => ({
        code: 0,
        stdout: JSON.stringify({ mode: 'auto', fans: [] }),
        stderr: ''
      }))
    })
    expect(await service.getStatus()).toEqual({ supported: false, reason: 'no-fans' })
  })

  it('reports smc-unavailable when the status helper fails', async () => {
    const { service } = createHarness({
      runHelper: vi.fn<RunHelper>(async () => ({
        code: 1,
        stdout: '{"error":"cannot open AppleSMC"}',
        stderr: ''
      }))
    })
    expect(await service.getStatus()).toEqual({ supported: false, reason: 'smc-unavailable' })
  })

  it('returns auto mode with per-fan readings on a supported Mac', async () => {
    const { service, runHelper } = createHarness()
    const status = expectSupported(await service.getStatus())
    expect(status.mode).toBe('auto')
    expect(status.pending).toBe(false)
    expect(status.fans).toEqual([
      { index: 0, rpm: 2300, minRpm: 2317, maxRpm: 6800 },
      { index: 1, rpm: 2500, minRpm: 2317, maxRpm: 6800 }
    ])
    expect(runHelper).toHaveBeenCalledWith(['status'])
  })
})

describe('FanControlService.setMode', () => {
  it('writes the lease, launches a detached privileged hold with shell-quoted args, and reaches max on ready', async () => {
    const { service, runPrivileged, files } = createHarness()
    const result = await service.setMode('max')

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).mode).toBe('max')
    expect(files.has(LEASE)).toBe(true)
    expect(runPrivileged).toHaveBeenCalledTimes(1)
    const [command] = runPrivileged.mock.calls[0]
    expect(command).toContain(`'${HELPER}' hold`)
    expect(command).toContain('--parent-pid 4242')
    expect(command).toContain(`--lease '${LEASE}'`)
    // Detached so osascript returns while the root hold keeps running.
    expect(command.trimEnd().endsWith('&')).toBe(true)
  })

  it('escapes single quotes in paths before handing them to the root shell', async () => {
    const lease = "/Users/o'brien/Library/Application Support/topo/fan-control.lease"
    const { service, runPrivileged } = createHarness({
      leasePath: lease,
      runPrivileged: (files) =>
        vi.fn<RunPrivileged>(async () => {
          files.set(lease, 'ready')
        })
    })
    await service.setMode('max')
    const [command] = runPrivileged.mock.calls[0]
    expect(command).toContain(
      `--lease '/Users/o'\\''brien/Library/Application Support/topo/fan-control.lease'`
    )
  })

  it('stays in auto, clears the lease and reports auth-cancelled when the password prompt is cancelled', async () => {
    const cancelled = Object.assign(new Error('execution error: User canceled. (-128)'), {
      code: 1,
      stderr: 'execution error: User canceled. (-128)'
    })
    const { service, files } = createHarness({
      runPrivileged: () =>
        vi.fn<RunPrivileged>(async () => {
          throw cancelled
        })
    })
    const result = await service.setMode('max')

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth-cancelled' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(files.has(LEASE)).toBe(false)
  })

  it('hides the control with write-rejected when the hold reports the SMC refused the write', async () => {
    const harness = createHarness()
    harness.runPrivileged.mockImplementation(async () => {
      harness.files.set(LEASE, 'write-rejected')
    })
    const result = await harness.service.setMode('max')

    expect(result.ok).toBe(false)
    expect(result.status).toEqual({ supported: false, reason: 'write-rejected' })
    expect(await harness.service.getStatus()).toEqual({
      supported: false,
      reason: 'write-rejected'
    })
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('reports helper-failed and stays in auto when the hold never signals ready', async () => {
    const { service, files } = createHarness({
      runPrivileged: () => vi.fn<RunPrivileged>(async () => {})
    })
    const result = await service.setMode('max')

    expect(result).toMatchObject({ ok: false, error: { kind: 'helper-failed' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(files.has(LEASE)).toBe(false)
  })

  it('returns to auto by removing the lease and notifies subscribers', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    const listener = vi.fn()
    service.subscribe(listener)

    const result = await service.setMode('auto')

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(files.has(LEASE)).toBe(false)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ supported: true, mode: 'auto' })
    )
  })

  it('is idempotent: max while already max does not prompt again', async () => {
    const { service, runPrivileged } = createHarness()
    await service.setMode('max')
    await service.setMode('max')
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers that a request is pending while the password prompt is open', async () => {
    const { service } = createHarness()
    const seen: FanControlStatus[] = []
    service.subscribe((status) => seen.push(status))
    await service.setMode('max')
    expect(seen.some((status) => status.supported && status.pending)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ supported: true, mode: 'max', pending: false })
  })
})

describe('FanControlService lifecycle', () => {
  it('removes the lease synchronously on quit so the root hold restores auto', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    service.releaseForQuit()
    expect(files.has(LEASE)).toBe(false)
  })

  it('releases max when the system suspends', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    await service.handleSuspend()
    expect(files.has(LEASE)).toBe(false)
    expect(expectSupported(await service.getStatus()).mode).toBe('auto')
  })

  it('surfaces hold-exited when the fans fall back to auto behind Topo', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    harness.runHelper.mockResolvedValue({ code: 0, stdout: TWO_FANS, stderr: '' })

    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('auto')
    expect(status.lastError?.kind).toBe('hold-exited')
    expect(harness.files.has(LEASE)).toBe(false)
  })
})
