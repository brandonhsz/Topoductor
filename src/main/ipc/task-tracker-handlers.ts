import { registerAvenaPMHandlers } from './avenapm/register-handlers'
import { registerJiraHandlers } from './jira/register-handlers'
import { registerLinearHandlers } from './linear/register-handlers'

/** Account-backed task trackers shown in Tasks (Linear, Jira, AvenaPM). */
export function registerTaskTrackerHandlers(): void {
  registerLinearHandlers()
  registerJiraHandlers()
  registerAvenaPMHandlers()
}
