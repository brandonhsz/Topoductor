import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FAN_CONTROL_CHANNELS,
  type FanControlSetResult,
  type FanControlStatus,
  type FanCurve,
  type ThermalSample
} from '../../shared/fan-control-contract'
import type { FanControlService } from '../power/fan-control-service'

const { handleMock, onMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, on: onMock },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { registerFanControlHandlers } from './fan-control'

const STATUS: FanControlStatus = { supported: false, reason: 'not-macos' }
const RESULT: FanControlSetResult = { ok: true, status: STATUS }

function fakeService() {
  return {
    getStatus: vi.fn(async () => STATUS),
    getHistory: vi.fn(async (): Promise<ThermalSample[]> => []),
    setMode: vi.fn(async () => RESULT),
    setCurve: vi.fn(async () => RESULT),
    setManualRpm: vi.fn(async () => RESULT),
    answerFeedback: vi.fn(async () => RESULT),
    resetSmartProfile: vi.fn(async () => RESULT),
    dismissPausedMode: vi.fn(async () => STATUS),
    setMonitoring: vi.fn(),
    subscribe: vi.fn(() => () => {})
  }
}

type FakeService = ReturnType<typeof fakeService>
let service: FakeService

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  if (!call) {
    throw new Error(`no handler registered for ${channel}`)
  }
  const fn = call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>
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
  registerFanControlHandlers(service as unknown as FanControlService)
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
    service.getHistory.mockResolvedValueOnce(history)
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
