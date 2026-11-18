import { describe, expect, it } from 'vitest'
import type { FanControlMode, ThermalSample } from '../../shared/fan-control-contract'
import { isFeedbackPromptExpired, nextFeedbackPrompt } from './fan-feedback-scheduler'

const MINUTE = 60_000
const NOW = Date.UTC(2026, 10, 17, 15, 0, 0)

type SchedulerInput = Parameters<typeof nextFeedbackPrompt>[0]

function sample(minutesAgo: number, blendC: number): ThermalSample {
  return {
    at: NOW - minutesAgo * MINUTE,
    chipC: blendC + 15,
    palmrestC: 30,
    blendC,
    palmrestAvailable: true,
    fanRpm: [2317, 2317]
  }
}

// Hot enough to ask, never asked before, flat history.
function input(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    now: NOW,
    mode: 'smart',
    enabled: true,
    tempC: 50,
    history: [sample(5, 50), sample(1, 50)],
    lastAskedAt: null,
    askedToday: 0,
    ...overrides
  }
}

describe('nextFeedbackPrompt', () => {
  it('asks in smart mode with the current temperature and time', () => {
    const prompt = nextFeedbackPrompt(input())

    expect(prompt).toMatchObject({ askedAt: NOW, tempC: 50 })
    expect(prompt?.id).toEqual(expect.any(String))
    expect(prompt?.id.length).toBeGreaterThan(0)
  })

  it('gives each prompt its own id', () => {
    const first = nextFeedbackPrompt(input())
    const second = nextFeedbackPrompt(input({ now: NOW + 120 * MINUTE }))

    expect(first?.id).not.toBe(second?.id)
  })

  it.each<FanControlMode>(['auto', 'max', 'curve', 'manual'])('never asks in %s mode', (mode) => {
    expect(nextFeedbackPrompt(input({ mode }))).toBeNull()
  })

  it('never asks when the user turned the questions off', () => {
    expect(nextFeedbackPrompt(input({ enabled: false }))).toBeNull()
  })

  it('never asks without a temperature', () => {
    expect(nextFeedbackPrompt(input({ tempC: null }))).toBeNull()
  })

  it('asks at most three times per day', () => {
    const longAgo = NOW - 3 * 60 * MINUTE

    expect(nextFeedbackPrompt(input({ askedToday: 2, lastAskedAt: longAgo }))).not.toBeNull()
    expect(nextFeedbackPrompt(input({ askedToday: 3, lastAskedAt: longAgo }))).toBeNull()
  })

  it('waits at least 90 minutes between questions', () => {
    expect(nextFeedbackPrompt(input({ lastAskedAt: NOW - 89 * MINUTE }))).toBeNull()
    expect(nextFeedbackPrompt(input({ lastAskedAt: NOW - 90 * MINUTE }))).not.toBeNull()
  })

  it('triggers once the blend reaches 45 °C', () => {
    const flat = (tempC: number) => [sample(5, tempC), sample(1, tempC)]

    expect(nextFeedbackPrompt(input({ tempC: 45, history: flat(45) }))).not.toBeNull()
    expect(nextFeedbackPrompt(input({ tempC: 44.9, history: flat(44.9) }))).toBeNull()
  })

  it('triggers on a jump of 8 °C or more within the last 10 minutes while cool', () => {
    expect(
      nextFeedbackPrompt(input({ tempC: 40, history: [sample(9, 32), sample(1, 38)] }))
    ).toMatchObject({ tempC: 40 })
    expect(
      nextFeedbackPrompt(input({ tempC: 40, history: [sample(9, 32.1), sample(1, 38)] }))
    ).toBeNull()
  })

  it('also triggers on a drop of 8 °C, so the user can say it now feels cold', () => {
    expect(
      nextFeedbackPrompt(input({ tempC: 36, history: [sample(8, 44), sample(1, 40)] }))
    ).not.toBeNull()
  })

  it('ignores temperature changes older than 10 minutes', () => {
    expect(
      nextFeedbackPrompt(input({ tempC: 40, history: [sample(11, 30), sample(1, 39)] }))
    ).toBeNull()
  })

  it('skips history samples without a blend reading', () => {
    const missing: ThermalSample = { ...sample(5, 0), blendC: null }

    expect(nextFeedbackPrompt(input({ tempC: 40, history: [missing, sample(1, 39)] }))).toBeNull()
  })
})

describe('isFeedbackPromptExpired', () => {
  const prompt = { id: 'p1', askedAt: NOW, tempC: 50 }

  it('expires an unanswered prompt after 3 minutes', () => {
    expect(isFeedbackPromptExpired(prompt, NOW + 3 * MINUTE - 1)).toBe(false)
    expect(isFeedbackPromptExpired(prompt, NOW + 3 * MINUTE)).toBe(true)
  })
})
