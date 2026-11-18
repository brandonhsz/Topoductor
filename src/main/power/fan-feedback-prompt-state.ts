import type { FanFeedbackPrompt } from '../../shared/fan-control-contract'
import {
  isFeedbackPromptExpired,
  nextFeedbackPrompt,
  type FeedbackSchedulerInput
} from './fan-feedback-scheduler'

function dayOf(now: number): string {
  return new Date(now).toDateString()
}

/** The live smart-mode question; only answered prompts count toward the daily limit. */
export class FanFeedbackPromptState {
  current: FanFeedbackPrompt | null = null
  private lastAskedAt: number | null = null
  private answered = { day: '', count: 0 }

  /** Drops an expired or out-of-mode prompt, then asks again when the scheduler allows. */
  refresh(input: Omit<FeedbackSchedulerInput, 'lastAskedAt' | 'askedToday'>): void {
    const { current } = this
    if (current && (input.mode !== 'smart' || isFeedbackPromptExpired(current, input.now))) {
      this.current = null
    }
    if (this.current) {
      return
    }
    const prompt = nextFeedbackPrompt({
      ...input,
      lastAskedAt: this.lastAskedAt,
      askedToday: this.answeredOn(input.now)
    })
    if (prompt) {
      this.current = prompt
      this.lastAskedAt = input.now
    }
  }

  /** Consumes the live prompt; a stale or expired id returns null so nothing is learned. */
  answer(promptId: string, now: number): FanFeedbackPrompt | null {
    const prompt = this.current
    if (!prompt || prompt.id !== promptId || isFeedbackPromptExpired(prompt, now)) {
      return null
    }
    this.current = null
    this.answered = { day: dayOf(now), count: this.answeredOn(now) + 1 }
    return prompt
  }

  dismiss(): void {
    this.current = null
  }

  private answeredOn(now: number): number {
    return this.answered.day === dayOf(now) ? this.answered.count : 0
  }
}
