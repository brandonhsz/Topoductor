import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FAN_CONTROL_CHANNELS,
  type FanControlSetResult,
  type FanControlStatus,
  type FanCurve,
  type ThermalSample
} from '../../shared/fan-control-contract'
import type { FanControlTimers } from '../power/fan-control-polling'
import { FanControlService, type FanControlServiceDeps } from '../power/fan-control-service'
import type { RunFanHelper } from '../power/fan-helper-readings'

const { handleMock, onMock } = vi.hoisted(() => ({
  handleMock:
    vi.fn<
      (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void
    >(),
  onMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, on: onMock },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { registerFanControlHandlers } from './fan-control'

const STATUS: FanControlStatus = { supported: false, reason: 'not-macos' }
const RESULT: FanControlSetResult = { ok: true, status: STATUS }

// Every public method is stubbed below, so these deps are never reached.
const INERT_DEPS: FanControlServiceDeps = {
  helperPath: null,
  leasePath: '',
  pid: 0,
  runPrivileged: vi.fn<FanControlServiceDeps['runPrivileged']>(),
  fs: {
    writeFile: vi.fn<FanControlServiceDeps['fs']['writeFile']>(),
    readFile: vi.fn<FanControlServiceDeps['fs']['readFile']>(),
    rm: vi.fn<FanControlServiceDeps['fs']['rm']>(),
    rmSync: vi.fn<FanControlServiceDeps['fs']['rmSync']>(),
    rename: vi.fn<FanControlServiceDeps['fs']['rename']>()
  },
  platform: 'darwin',
  profilePath: '',
  runHelper: vi.fn<RunFanHelper>(),
  getSettings: vi.fn<FanControlServiceDeps['getSettings']>(),
  updateSettings: vi.fn<FanControlServiceDeps['updateSettings']>(),
  now: vi.fn<FanControlServiceDeps['now']>(),
  timers: {
    setInterval: vi.fn<FanControlTimers['setInterval']>(),
    clearInterval: vi.fn<FanControlTimers['clearInterval']>()
  }
}

function fakeService(): FanControlService {
  const fake = new FanControlService(INERT_DEPS)
  vi.spyOn(fake, 'getStatus').mockImplementation(async () => STATUS)
  vi.spyOn(fake, 'getHistory').mockImplementation(async (): Promise<ThermalSample[]> => [])
  vi.spyOn(fake, 'setMode').mockImplementation(async () => RESULT)
  vi.spyOn(fake, 'setCurve').mockImplementation(async () => RESULT)
  vi.spyOn(fake, 'setManualRpm').mockImplementation(async () => RESULT)
  vi.spyOn(fake, 'answerFeedback').mockImplementation(async () => RESULT)
  vi.spyOn(fake, 'resetSmartProfile').mockImplementation(async () => RESULT)
  vi.spyOn(fake, 'dismissPausedMode').mockImplementation(async () => STATUS)
  vi.spyOn(fake, 'setMonitoring').mockImplementation(() => {})
  vi.spyOn(fake, 'subscribe').mockImplementation(() => () => {})
  return fake
}

let service: FanControlService

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  if (!call) {
    throw new Error(`no handler registered for ${channel}`)
  }
  const fn = call[1]
  return async (...args) => fn({}, ...args)
}

const VALID_CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 60, percent: 0 },
    { tempC: 80, percent: 70 }
  ]
}

beforeEach(() => {
  handleMock.mockReset()
  onMock.mockReset()
  service = fakeService()
  registerFanControlHandlers(service)
})

describe('fan control IPC: setMode', () => {
  it.each(['auto', 'max', 'curve', 'smart', 'manual'] as const)('delegates %s', async (mode) => {
    await expect(handler(FAN_CONTROL_CHANNELS.setMode)(mode)).resolves.toBe(RESULT)
    expect(service.setMode).toHaveBeenCalledWith(mode)
  })

  it.each([['turbo'], [1], [undefined], [null]])(
    'rejects %s without calling the service',
    async (mode) => {
      await expect(handler(FAN_CONTROL_CHANNELS.setMode)(mode)).rejects.toThrow()
      expect(service.setMode).not.toHaveBeenCalled()
    }
  )
})

describe('fan control IPC: getHistory', () => {
  it('returns the service history', async () => {
    const history: ThermalSample[] = [
      { at: 1, chipC: 60, palmrestC: 30, blendC: 50, palmrestAvailable: true, fanRpm: [2317] }
    ]
    vi.mocked(service.getHistory).mockResolvedValueOnce(history)
    await expect(handler(FAN_CONTROL_CHANNELS.getHistory)()).resolves.toBe(history)
  })
})

describe('fan control IPC: setCurve', () => {
  it('delegates a well-formed curve', async () => {
    await expect(handler(FAN_CONTROL_CHANNELS.setCurve)(VALID_CURVE)).resolves.toBe(RESULT)
    expect(service.setCurve).toHaveBeenCalledWith(VALID_CURVE)
  })

  // Ordering and ranges are the service's invalid-curve error, not an IPC throw.
  it('delegates a well-shaped but out-of-order curve so the service reports invalid-curve', async () => {
    const reversed: FanCurve = { source: 'chip', points: VALID_CURVE.points.toReversed() }
    await handler(FAN_CONTROL_CHANNELS.setCurve)(reversed)
    expect(service.setCurve).toHaveBeenCalledWith(reversed)
  })

  it.each([
    ['a string', 'curve'],
    ['null', null],
    ['an array', [VALID_CURVE]],
    ['an unknown source', { ...VALID_CURVE, source: 'gpu' }],
    ['points that are not an array', { ...VALID_CURVE, points: 'fast' }],
    [
      'a point with a string temperature',
      { source: 'blend', points: [{ tempC: '60', percent: 0 }] }
    ],
    [
      'a point with a non-finite percent',
      { source: 'blend', points: [{ tempC: 60, percent: Number.NaN }] }
    ],
    ['a null point', { source: 'blend', points: [null] }]
  ])('rejects %s without calling the service', async (_label, curve) => {
    await expect(handler(FAN_CONTROL_CHANNELS.setCurve)(curve)).rejects.toThrow()
    expect(service.setCurve).not.toHaveBeenCalled()
  })
})

describe('fan control IPC: setManualRpm', () => {
  it.each([
    [0, 3500],
    [1, 0]
  ])('delegates fan %i at %i rpm', async (index, rpm) => {
    await expect(handler(FAN_CONTROL_CHANNELS.setManualRpm)(index, rpm)).resolves.toBe(RESULT)
    expect(service.setManualRpm).toHaveBeenCalledWith(index, rpm)
  })

  it.each([
    ['a non-finite rpm', 0, Number.POSITIVE_INFINITY],
    ['a NaN rpm', 0, Number.NaN],
    ['a string rpm', 0, '3500'],
    ['a negative index', -1, 3500],
    ['a fractional index', 0.5, 3500],
    ['a string index', '0', 3500]
  ])('rejects %s without calling the service', async (_label, index, rpm) => {
    await expect(handler(FAN_CONTROL_CHANNELS.setManualRpm)(index, rpm)).rejects.toThrow()
    expect(service.setManualRpm).not.toHaveBeenCalled()
  })
})

describe('fan control IPC: answerFeedback', () => {
  it.each(['cold', 'warm', 'hot', 'never'] as const)('delegates %s', async (reply) => {
    await expect(handler(FAN_CONTROL_CHANNELS.answerFeedback)('prompt-1', reply)).resolves.toBe(
      RESULT
    )
    expect(service.answerFeedback).toHaveBeenCalledWith('prompt-1', reply)
  })

  it.each([
    ['an answer outside the enum', 'prompt-1', 'freezing'],
    ['a numeric answer', 'prompt-1', 2],
    ['a numeric prompt id', 7, 'hot'],
    ['an empty prompt id', '', 'hot']
  ])('rejects %s without calling the service', async (_label, promptId, reply) => {
    await expect(handler(FAN_CONTROL_CHANNELS.answerFeedback)(promptId, reply)).rejects.toThrow()
    expect(service.answerFeedback).not.toHaveBeenCalled()
  })
})

describe('fan control IPC: profile and paused mode', () => {
  it('resetSmartProfile delegates to the service', async () => {
    await expect(handler(FAN_CONTROL_CHANNELS.resetSmartProfile)()).resolves.toBe(RESULT)
    expect(service.resetSmartProfile).toHaveBeenCalledTimes(1)
  })

  it('dismissPausedMode delegates and returns the status', async () => {
    await expect(handler(FAN_CONTROL_CHANNELS.dismissPausedMode)()).resolves.toBe(STATUS)
    expect(service.dismissPausedMode).toHaveBeenCalledTimes(1)
  })
})
