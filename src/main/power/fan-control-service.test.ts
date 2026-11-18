import { describe, expect, it, vi } from 'vitest'
import type { FanControlStatus, FanCurve } from '../../shared/fan-control-contract'
import {
  HELPER,
  LEASE,
  PROFILE,
  MIN_RPM,
  MAX_RPM,
  TICK_MS,
  MINUTE,
  START,
  TWO_FAN_READINGS,
  TWO_FANS,
  initialSmartPoints,
  STORED_SMART_POINTS,
  CHIP_CURVE,
  sensorsOutput,
  createHarness,
  expectSupported,
  leaseTargets,
  storedProfile,
  profileFile,
  startSmartPrompt,
  sensorReads,
  fireInterval,
  settle,
  type RunHelper,
  type RunPrivileged
} from './fan-control-service.test-support'

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
    expect(status.controllable).toBe(true)
    expect(status.session).toBe('none')
    expect(status.fans).toEqual(TWO_FAN_READINGS)
    expect(runHelper).toHaveBeenCalledWith(['status'])
  })

  it('keeps fanless Macs supported but not controllable, showing temperatures only', async () => {
    const harness = createHarness({ sensors: { chipC: 70 } })
    harness.runHelper.mockImplementation(async (args) => ({
      code: 0,
      stdout:
        args[0] === 'sensors'
          ? sensorsOutput(harness.sensors)
          : JSON.stringify({ mode: 'auto', fans: [] }),
      stderr: ''
    }))

    harness.service.setMonitoring(true)
    const status = expectSupported(await harness.service.tick())

    expect(status.controllable).toBe(false)
    expect(status.fans).toEqual([])
    expect(status.thermal.chipC).toBe(70)
    expect(status.thermal.palmrestAvailable).toBe(false)
  })

  it('refuses a non-auto mode on a fanless Mac without asking for the password', async () => {
    const harness = createHarness()
    harness.runHelper.mockImplementation(async (args) => ({
      code: 0,
      stdout:
        args[0] === 'sensors'
          ? sensorsOutput(harness.sensors)
          : JSON.stringify({ mode: 'auto', fans: [] }),
      stderr: ''
    }))

    const result = await harness.service.setMode('curve')

    expect(result).toMatchObject({ ok: false, error: { kind: 'not-controllable' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })
})

describe('FanControlService control session', () => {
  it('opens one detached root control session with shell-quoted args and writes max targets once ready', async () => {
    const { service, runPrivileged, files } = createHarness()
    const result = await service.setMode('max')

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('max')
    expect(status.session).toBe('active')
    expect(status.appliedRpm).toEqual([MAX_RPM, MAX_RPM])
    expect(leaseTargets(files)).toEqual([MAX_RPM, MAX_RPM])
    expect(runPrivileged).toHaveBeenCalledTimes(1)
    const [command] = runPrivileged.mock.calls[0]
    expect(command).toContain(`'${HELPER}' control`)
    expect(command).not.toContain(' hold ')
    expect(command).toContain('--parent-pid 4242')
    expect(command).toContain(`--lease '${LEASE}'`)
    // Detached so osascript returns while the root session keeps running.
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

  it('asks for the password once per Topo session across curve, smart, manual, max and auto', async () => {
    const { service, runPrivileged } = createHarness({ sensors: { chipC: 60 } })
    await service.setCurve(CHIP_CURVE)

    for (const mode of ['curve', 'smart', 'manual', 'max', 'auto', 'curve'] as const) {
      const result = await service.setMode(mode)
      expect(result.ok).toBe(true)
      expect(expectSupported(result.status).mode).toBe(mode)
    }
    await service.setManualRpm(0, 3000)

    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('shares one password prompt between concurrent mode requests', async () => {
    const { service, runPrivileged } = createHarness()
    await Promise.all([service.setMode('curve'), service.setMode('smart')])
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('keeps the root session alive with null targets when returning to auto', async () => {
    const { service, files, runPrivileged } = createHarness()
    await service.setMode('max')
    const listener = vi.fn()
    service.subscribe(listener)

    const result = await service.setMode('auto')

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('auto')
    expect(status.session).toBe('active')
    expect(status.appliedRpm).toEqual([null, null])
    expect(leaseTargets(files)).toEqual([null, null])
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ supported: true, mode: 'auto' })
    )

    await service.setMode('max')
    expect(runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('stays in auto, clears the lease and reports auth-cancelled when the password prompt is cancelled', async () => {
    const cancelled = Object.assign(new Error('execution error: User canceled. (-128)'), {
      code: 1,
      stderr: 'execution error: User canceled. (-128)'
    })
    const { service, files, runPrivileged } = createHarness({
      runPrivileged: () =>
        vi.fn<RunPrivileged>(async () => {
          throw cancelled
        })
    })
    const result = await service.setMode('curve')

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth-cancelled' } })
    const status = expectSupported(result.status)
    expect(status.mode).toBe('auto')
    expect(status.session).toBe('none')
    expect(status.lastError).toEqual({ kind: 'auth-cancelled' })
    expect(files.has(LEASE)).toBe(false)

    // No session was opened, so the next attempt has to ask again.
    await service.setMode('curve')
    expect(runPrivileged).toHaveBeenCalledTimes(2)
  })

  it('hides the control with write-rejected when the session reports the SMC refused the write', async () => {
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

  it('reports helper-failed and stays in auto when the session never signals ready', async () => {
    const { service, files } = createHarness({
      runPrivileged: () => vi.fn<RunPrivileged>(async () => {})
    })
    const result = await service.setMode('max')

    expect(result).toMatchObject({ ok: false, error: { kind: 'helper-failed' } })
    expect(expectSupported(result.status).mode).toBe('auto')
    expect(files.has(LEASE)).toBe(false)
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
    expect(
      seen.some((status) => status.supported && status.pending && status.session === 'pending')
    ).toBe(true)
    expect(seen.at(-1)).toMatchObject({
      supported: true,
      mode: 'max',
      pending: false,
      session: 'active'
    })
  })
})

describe('FanControlService curve and manual modes', () => {
  it('writes curve targets from the chosen temperature line and hands fans back to macOS below the threshold', async () => {
    const harness = createHarness({ sensors: { chipC: 60, palmrestC: 30 } })
    await harness.service.setCurve(CHIP_CURVE)
    const result = await harness.service.setMode('curve')

    expect(expectSupported(result.status).appliedRpm).toEqual([MAX_RPM, MAX_RPM])
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    harness.sensors.chipC = 40
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([MIN_RPM, MIN_RPM])
    expect(leaseTargets(harness.files)).toEqual([MIN_RPM, MIN_RPM])

    harness.sensors.chipC = 30
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([null, null])
    expect(leaseTargets(harness.files)).toEqual([null, null])
  })

  it('saves a valid curve without switching mode or prompting, and rejects an invalid one', async () => {
    const harness = createHarness()
    const saved = await harness.service.setCurve(CHIP_CURVE)

    expect(saved.ok).toBe(true)
    const status = expectSupported(saved.status)
    expect(status.mode).toBe('auto')
    expect(status.curve).toEqual(CHIP_CURVE)
    expect(storedProfile(harness.files)).toMatchObject({ curve: CHIP_CURVE })
    expect(harness.runPrivileged).not.toHaveBeenCalled()

    const descending: FanCurve = {
      source: 'chip',
      points: [
        { tempC: 70, percent: 10 },
        { tempC: 50, percent: 90 }
      ]
    }
    const rejected = await harness.service.setCurve(descending)

    expect(rejected).toMatchObject({ ok: false, error: { kind: 'invalid-curve' } })
    expect(expectSupported(rejected.status).curve).toEqual(CHIP_CURVE)
    expect(storedProfile(harness.files)).toMatchObject({ curve: CHIP_CURVE })
  })

  it('switches to manual on setManualRpm and keeps the fixed speed until another mode is chosen', async () => {
    const harness = createHarness({ sensors: { chipC: 60 } })
    await harness.service.setCurve(CHIP_CURVE)

    const result = await harness.service.setManualRpm(0, 3000)

    expect(result.ok).toBe(true)
    const status = expectSupported(result.status)
    expect(status.mode).toBe('manual')
    // Fan 2 already spins at 2500, so entering manual holds it there.
    expect(status.manualRpm).toEqual({ 0: 3000, 1: 2500 })
    expect(status.appliedRpm).toEqual([3000, 2500])
    expect(leaseTargets(harness.files)).toEqual([3000, 2500])

    harness.sensors.chipC = 100
    expect(expectSupported(await harness.service.tick()).appliedRpm).toEqual([3000, 2500])
    expect(leaseTargets(harness.files)).toEqual([3000, 2500])

    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    // `manual` reuses the speeds already set per fan.
    await harness.service.setMode('manual')
    expect(leaseTargets(harness.files)).toEqual([3000, 2500])
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'manual' })
  })

  it('keeps the other fans at their current speed when entering manual by setting one fan', async () => {
    const harness = createHarness({
      fans: [
        { index: 0, rpm: 3300, minRpm: MIN_RPM, maxRpm: MAX_RPM },
        { index: 1, rpm: 6843, minRpm: MIN_RPM, maxRpm: MAX_RPM }
      ]
    })
    await harness.service.setMode('max')

    const status = expectSupported((await harness.service.setManualRpm(0, 4000)).status)

    expect(status.manualRpm).toEqual({ 0: 4000, 1: MAX_RPM })
    expect(leaseTargets(harness.files)).toEqual([4000, MAX_RPM])

    // Already manual: moving one fan leaves the other where the user put it.
    await harness.service.setManualRpm(1, 3000)
    expect(leaseTargets(harness.files)).toEqual([4000, 3000])
  })

  it('leaves a stopped or below-minimum fan with macOS when entering manual', async () => {
    const harness = createHarness({
      fans: [
        { index: 0, rpm: 0, minRpm: MIN_RPM, maxRpm: MAX_RPM },
        { index: 1, rpm: 2500, minRpm: MIN_RPM, maxRpm: MAX_RPM }
      ],
      initialFiles: profileFile({ lastMode: 'auto', manualRpm: { 0: 5000 } })
    })

    await harness.service.setManualRpm(1, 4000)

    expect(leaseTargets(harness.files)).toEqual([null, 4000])
  })

  it('hands a fan back to macOS with rpm 0', async () => {
    const harness = createHarness()
    await harness.service.setManualRpm(0, 3000)
    await harness.service.setManualRpm(1, 4000)
    await harness.service.setManualRpm(0, 0)
    expect(leaseTargets(harness.files)).toEqual([null, 4000])
  })

  it.each([
    ['below minRpm', 0, 1000],
    ['above maxRpm', 0, 7000],
    ['not finite', 0, Number.NaN],
    ['unknown fan', 5, 3000]
  ])(
    'rejects a manual speed %s without prompting or switching mode',
    async (_label, index, rpm) => {
      const harness = createHarness()
      const result = await harness.service.setManualRpm(index, rpm)

      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-rpm' } })
      expect(expectSupported(result.status).mode).toBe('auto')
      expect(harness.runPrivileged).not.toHaveBeenCalled()
    }
  )
})

describe('FanControlService smart mode feedback', () => {
  it('raises the fans on the next tick after a hot answer and persists what it learned', async () => {
    const harness = createHarness()
    const { feedbackPrompt, appliedRpm: before } = await startSmartPrompt(harness)
    for (const rpm of before) {
      expect(rpm).not.toBeNull()
      expect(rpm).toBeLessThan(MAX_RPM)
    }

    const answered = await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'hot')

    expect(answered.ok).toBe(true)
    expect(expectSupported(answered.status).feedbackPrompt).toBeNull()
    const after = expectSupported(await harness.service.tick())
    after.appliedRpm.forEach((rpm, index) => {
      expect(rpm).toBeGreaterThan(before[index] ?? 0)
      expect(rpm).toBeLessThanOrEqual(MAX_RPM)
    })
    expect(leaseTargets(harness.files)).toEqual(after.appliedRpm)
    expect(after.smart.answers).toBe(1)
    expect(after.smart.updatedAt).toBe(harness.clock.now)
    expect(storedProfile(harness.files)).toMatchObject({
      smart: { answers: 1, learned: after.smart.learned }
    })
    expect(after.smart.learned).not.toEqual(await initialSmartPoints())
  })

  it('ignores a stale prompt id without learning', async () => {
    const harness = createHarness()
    await startSmartPrompt(harness)

    const result = await harness.service.answerFeedback('stale-prompt', 'hot')

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).smart.answers).toBe(0)
  })

  it('turns questions off through updateSettings on "never" without learning', async () => {
    const harness = createHarness()
    const { feedbackPrompt } = await startSmartPrompt(harness)

    const result = await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'never')

    expect(result.ok).toBe(true)
    expect(harness.updateSettings).toHaveBeenCalledWith({ fanSmartFeedbackPrompts: false })
    const status = expectSupported(result.status)
    expect(status.feedbackPrompt).toBeNull()
    expect(status.smart.answers).toBe(0)

    harness.clock.now += 24 * 60 * MINUTE
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('never asks while the setting is off', async () => {
    const harness = createHarness({ fanSmartFeedbackPrompts: false, sensors: { chipC: 65 } })
    await harness.service.setMode('smart')
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('drops an unanswered prompt once it expires', async () => {
    const harness = createHarness()
    await startSmartPrompt(harness)

    harness.clock.now += 4 * MINUTE
    expect(expectSupported(await harness.service.tick()).feedbackPrompt).toBeNull()
  })

  it('restores the initial smart curve on resetSmartProfile and persists it', async () => {
    const harness = createHarness()
    const fresh = expectSupported(await harness.service.getStatus())
    expect(fresh.smart).toEqual({
      learned: await initialSmartPoints(),
      answers: 0,
      updatedAt: null
    })
    const { feedbackPrompt } = await startSmartPrompt(harness)
    await harness.service.answerFeedback(feedbackPrompt?.id ?? '', 'hot')

    const result = await harness.service.resetSmartProfile()

    expect(result.ok).toBe(true)
    expect(expectSupported(result.status).smart).toEqual(fresh.smart)
    expect(storedProfile(harness.files)).toMatchObject({ smart: fresh.smart })
  })
})

describe('FanControlService profile and relaunch', () => {
  it('starts in auto with the previous mode paused and never prompts on launch', async () => {
    const harness = createHarness({
      initialFiles: profileFile({ lastMode: 'smart', manualRpm: { 0: 3200 } }),
      sensors: { chipC: 90 }
    })

    const status = expectSupported(await harness.service.getStatus())
    harness.service.setMonitoring(true)
    await harness.service.tick()

    expect(status.mode).toBe('auto')
    expect(status.pausedMode).toBe('smart')
    expect(status.session).toBe('none')
    expect(status.curve).toEqual(CHIP_CURVE)
    expect(status.manualRpm).toEqual({ 0: 3200 })
    expect(status.smart).toEqual({
      learned: STORED_SMART_POINTS,
      answers: 2,
      updatedAt: START - MINUTE
    })
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('clears the paused mode when the user reactivates it', async () => {
    const harness = createHarness({ initialFiles: profileFile({ lastMode: 'curve' }) })
    await harness.service.getStatus()

    const result = await harness.service.setMode('curve')

    expect(expectSupported(result.status).pausedMode).toBeNull()
    expect(harness.runPrivileged).toHaveBeenCalledTimes(1)
  })

  it('forgets the paused mode for the next launch once dismissed', async () => {
    const harness = createHarness({ initialFiles: profileFile({ lastMode: 'max' }) })
    await harness.service.getStatus()

    const dismissed = expectSupported(await harness.service.dismissPausedMode())

    expect(dismissed.pausedMode).toBeNull()
    expect(dismissed.mode).toBe('auto')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'auto' })
  })

  it('persists the chosen mode so a relaunch can offer it again', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'max' })
    await harness.service.setMode('auto')
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'auto' })
  })

  it('falls back to defaults when the stored profile is corrupt', async () => {
    const { DEFAULT_USER_CURVE } = await import('./fan-curve-model')
    const harness = createHarness({ initialFiles: { [PROFILE]: '{"curve": [' } })
    const status = expectSupported(await harness.service.getStatus())

    expect(status.mode).toBe('auto')
    expect(status.pausedMode).toBeNull()
    expect(status.curve).toEqual(DEFAULT_USER_CURVE)
    expect(status.manualRpm).toEqual({})
    expect(status.smart.answers).toBe(0)
  })
})

describe('FanControlService sensor polling', () => {
  it('polls every 2 s only while a mode other than auto is active or someone is watching', async () => {
    const { service, timers } = createHarness()
    await service.getStatus()
    expect(timers.active.size).toBe(0)

    service.setMonitoring(true)
    expect([...timers.active.values()]).toEqual([TICK_MS])
    service.setMonitoring(false)
    expect(timers.active.size).toBe(0)

    await service.setMode('curve')
    expect([...timers.active.values()]).toEqual([TICK_MS])
    await service.setMode('auto')
    expect(timers.active.size).toBe(0)
  })

  it('reads temperatures in auto while monitoring without opening a session', async () => {
    const harness = createHarness({ sensors: { chipC: 70, palmrestC: 33 } })
    harness.service.setMonitoring(true)

    const status = expectSupported(await harness.service.tick())

    expect(harness.runHelper).toHaveBeenCalledWith(['sensors'])
    expect(status.thermal).toMatchObject({ chipC: 70, palmrestC: 33, palmrestAvailable: true })
    expect(status.mode).toBe('auto')
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('samples once per interval while an open panel keeps re-sending setMonitoring(true)', async () => {
    const harness = createHarness()
    harness.service.setMonitoring(true)
    await settle()
    expect(sensorReads(harness)).toBe(1)

    for (let ping = 0; ping < 3; ping++) {
      harness.clock.now += TICK_MS
      harness.service.setMonitoring(true)
      await settle()
    }
    expect(sensorReads(harness)).toBe(1)

    fireInterval(harness)
    await settle()
    expect(sensorReads(harness)).toBe(2)
    expect(await harness.service.getHistory()).toHaveLength(2)
  })

  it('stops polling once the viewer stops pinging, as when its window hides', async () => {
    const harness = createHarness()
    harness.service.setMonitoring(true)
    await settle()

    harness.clock.now += 4 * TICK_MS
    fireInterval(harness)
    await settle()
    expect(harness.timers.active.size).toBe(0)

    harness.service.setMonitoring(true)
    expect([...harness.timers.active.values()]).toEqual([TICK_MS])
  })

  it('keeps about 10 minutes of samples in the history', async () => {
    const harness = createHarness()
    harness.service.setMonitoring(true)
    await harness.service.tick()
    harness.clock.now += 5 * MINUTE
    await harness.service.tick()
    harness.clock.now += 6 * MINUTE
    await harness.service.tick()

    const history = await harness.service.getHistory()

    expect(history.map((sample) => sample.at)).toEqual([START + 5 * MINUTE, START + 11 * MINUTE])
    expect(history.every((sample) => sample.fanRpm.length === 2)).toBe(true)
  })
})

describe('FanControlService lifecycle', () => {
  it('removes the lease synchronously on quit so the root session restores auto', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    service.releaseForQuit()
    expect(files.has(LEASE)).toBe(false)
  })

  it('removes the lease on quit even while the live session sits in auto, and stops ticking', async () => {
    const { service, files, timers } = createHarness({ sensors: { chipC: 60 } })
    await service.setCurve(CHIP_CURVE)
    await service.setMode('curve')
    service.releaseForQuit()

    expect(files.has(LEASE)).toBe(false)
    expect(timers.active.size).toBe(0)
    await service.tick()
    expect(files.has(LEASE)).toBe(false)
    // The relaunch should still offer the mode that was running.
    expect(storedProfile(files)).toMatchObject({ lastMode: 'curve' })
  })

  it('removes the lease on quit after returning to auto with the session still open', async () => {
    const { service, files } = createHarness()
    await service.setMode('max')
    await service.setMode('auto')
    service.releaseForQuit()
    expect(files.has(LEASE)).toBe(false)
  })

  it('hands fans to macOS while asleep and resumes the mode on wake without a new password', async () => {
    const harness = createHarness({ sensors: { chipC: 60 } })
    await harness.service.setCurve(CHIP_CURVE)
    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])

    await harness.service.handleSuspend()

    expect(leaseTargets(harness.files)).toEqual([null, null])
    const asleep = expectSupported(await harness.service.getStatus())
    expect(asleep.mode).toBe('curve')
    expect(asleep.session).toBe('active')
    expect(asleep.appliedRpm).toEqual([null, null])
    await harness.service.tick()
    expect(leaseTargets(harness.files)).toEqual([null, null])

    await harness.service.handleResume()

    expect(leaseTargets(harness.files)).toEqual([MAX_RPM, MAX_RPM])
    expect(expectSupported(await harness.service.getStatus()).mode).toBe('curve')
    expect(harness.runPrivileged).toHaveBeenCalledTimes(1)
    expect(storedProfile(harness.files)).toMatchObject({ lastMode: 'curve' })
  })

  it('does nothing on wake when no session was ever opened', async () => {
    const harness = createHarness()
    await harness.service.getStatus()
    await harness.service.handleSuspend()
    await harness.service.handleResume()
    expect(harness.runPrivileged).not.toHaveBeenCalled()
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('surfaces hold-exited and closes the session when fixed fans fall back to auto behind Topo', async () => {
    const harness = createHarness()
    await harness.service.setMode('max')
    harness.runHelper.mockResolvedValue({ code: 0, stdout: TWO_FANS, stderr: '' })
    // Past the write grace period, two auto readings in a row mean the root loop let go.
    harness.clock.now += 3_000
    await harness.service.refresh()
    harness.clock.now += TICK_MS
    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('auto')
    expect(status.session).toBe('none')
    expect(status.lastError?.kind).toBe('hold-exited')
    expect(harness.files.has(LEASE)).toBe(false)
  })

  it('does not report hold-exited while every target is null and macOS owns the fans', async () => {
    const harness = createHarness({ sensors: { chipC: 30 } })
    await harness.service.setCurve(CHIP_CURVE)
    await harness.service.setMode('curve')
    expect(leaseTargets(harness.files)).toEqual([null, null])

    const status = expectSupported(await harness.service.refresh())

    expect(status.mode).toBe('curve')
    expect(status.session).toBe('active')
    expect(status.lastError).toBeUndefined()
  })
})
