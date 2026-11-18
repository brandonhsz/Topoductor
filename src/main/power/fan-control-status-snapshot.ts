import type { FanControlStatus } from '../../shared/fan-control-contract'
import type { FanControlLoop } from './fan-control-loop'
import type { FanControlProfileStore } from './fan-control-profile-store'
import type { FanControlSessionLease } from './fan-control-session-lease'
import type { FanFeedbackPromptState } from './fan-feedback-prompt-state'

/** The renderer-facing status assembled from the loop, profile, lease and pending question. */
export function fanControlStatusSnapshot({
  loop,
  profile,
  lease,
  feedback
}: {
  loop: FanControlLoop
  profile: FanControlProfileStore
  lease: FanControlSessionLease
  feedback: FanFeedbackPromptState
}): FanControlStatus {
  if (loop.smcUnavailable) {
    return { supported: false, reason: 'smc-unavailable' }
  }
  const { curve, smart, manualRpm } = profile.current
  const { mode, fans, thermal, appliedRpm, lastError } = loop
  return {
    supported: true,
    controllable: fans.length > 0,
    mode,
    fans,
    thermal,
    curve,
    smart,
    manualRpm,
    appliedRpm,
    session: lease.state,
    pausedMode: profile.pausedMode,
    feedbackPrompt: feedback.current,
    pending: lease.state === 'pending',
    ...(lastError ? { lastError } : {})
  }
}
