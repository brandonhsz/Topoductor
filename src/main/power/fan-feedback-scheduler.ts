import type {
  FanControlMode,
  FanFeedbackPrompt,
  ThermalSample
} from '../../shared/fan-control-contract'

const MINUTE_MS = 60_000

export const FEEDBACK_HOT_TEMP_C = 45
export const FEEDBACK_JUMP_C = 8
export const FEEDBACK_JUMP_WINDOW_MS = 10 * MINUTE_MS
export const FEEDBACK_MAX_PER_DAY = 3
export const FEEDBACK_MIN_GAP_MS = 90 * MINUTE_MS
export const FEEDBACK_PROMPT_TTL_MS = 3 * MINUTE_MS

export type FeedbackSchedulerInput = {
  now: number
  mode: FanControlMode
  enabled: boolean
  /** Current blend temperature. */
  tempC: number | null
  history: ThermalSample[]
  lastAskedAt: number | null
  /** Answered prompts today; expired ones must not be counted. */
  askedToday: number
}

function changedRecently(tempC: number, history: ThermalSample[], now: number): boolean {
  return history.some(
    (sample) =>
      sample.blendC !== null &&
      now - sample.at <= FEEDBACK_JUMP_WINDOW_MS &&
      Math.abs(tempC - sample.blendC) >= FEEDBACK_JUMP_C
  )
}

export function nextFeedbackPrompt(input: FeedbackSchedulerInput): FanFeedbackPrompt | null {
  const { now, tempC, lastAskedAt } = input
  if (input.mode !== 'smart' || !input.enabled || tempC === null) {
    return null
  }
  if (input.askedToday >= FEEDBACK_MAX_PER_DAY) {
    return null
  }
  if (lastAskedAt !== null && now - lastAskedAt < FEEDBACK_MIN_GAP_MS) {
    return null
  }
  if (tempC < FEEDBACK_HOT_TEMP_C && !changedRecently(tempC, input.history, now)) {
    return null
  }
  return { id: `fan-feedback-${now}`, askedAt: now, tempC }
}

export function isFeedbackPromptExpired(prompt: FanFeedbackPrompt, now: number): boolean {
  return now - prompt.askedAt >= FEEDBACK_PROMPT_TTL_MS
}
