import type {
  AutomationSchedulePreset,
  AutomationWorkspaceMode
} from '../../../../shared/automations/automation-definition'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export type AutomationTemplate = {
  id: string
  category: string
  label: string
  description: string
  name: string
  prompt: string
  preset: AutomationSchedulePreset
  time?: string
  dayOfWeek?: string
  agentId?: TuiAgent
  missedRunGraceMinutes?: string
  workspaceMode?: AutomationWorkspaceMode
}

export const getAutomationTemplates = createLocalizedCatalog((): AutomationTemplate[] => [
  {
    id: 'repo-health-weekday',
    category: translate(
      'auto.components.automations.automation.templates.repoHealth.category',
      'Repo health'
    ),
    label: translate(
      'auto.components.automations.automation.templates.b84757677d',
      'Weekday repo audit'
    ),
    description: translate(
      'auto.components.automations.automation.templates.a7fbd32ddb',
      'Check dependencies, failing tests, and risky open changes each weekday.'
    ),
    name: translate(
      'auto.components.automations.automation.templates.repoHealth.name',
      'Weekday repo audit'
    ),
    prompt: translate(
      'auto.components.automations.automation.templates.repoHealth.prompt',
      'Review the repository health. Check dependency updates, failing tests, lint/typecheck status, and risky open changes. Summarize findings and suggest the next action.'
    ),
    preset: 'weekdays',
    time: '09:00',
    missedRunGraceMinutes: '720'
  },
  {
    id: 'release-prep-weekly',
    category: translate(
      'auto.components.automations.automation.templates.releasePrep.category',
      'Release prep'
    ),
    label: translate(
      'auto.components.automations.automation.templates.39ed39280a',
      'Release readiness'
    ),
    description: translate(
      'auto.components.automations.automation.templates.513401db93',
      'Prepare a weekly release risk summary from the current project state.'
    ),
    name: translate(
      'auto.components.automations.automation.templates.releasePrep.name',
      'Release readiness review'
    ),
    prompt: translate(
      'auto.components.automations.automation.templates.releasePrep.prompt',
      'Prepare a release readiness summary. Look for blockers, unmerged risky changes, missing validation, and documentation gaps. End with a concise release/no-release recommendation.'
    ),
    preset: 'weekly',
    time: '14:00',
    dayOfWeek: '4',
    missedRunGraceMinutes: '1440'
  },
  {
    id: 'recurring-review-daily',
    category: translate(
      'auto.components.automations.automation.templates.recurringReview.category',
      'Recurring review'
    ),
    label: translate(
      'auto.components.automations.automation.templates.6023075b27',
      'Daily change review'
    ),
    description: translate(
      'auto.components.automations.automation.templates.3b7281c75f',
      'Scan recent work and call out correctness, UX, and test coverage risks.'
    ),
    name: translate(
      'auto.components.automations.automation.templates.recurringReview.name',
      'Daily change review'
    ),
    prompt: translate(
      'auto.components.automations.automation.templates.recurringReview.prompt',
      'Review recent changes in this workspace. Focus on correctness risks, UX regressions, missing tests, and follow-up tasks. Keep the report short and actionable.'
    ),
    preset: 'daily',
    time: '16:30',
    missedRunGraceMinutes: '180'
  },
  {
    id: 'maintenance-hourly',
    category: translate(
      'auto.components.automations.automation.templates.maintenance.category',
      'Maintenance'
    ),
    label: translate(
      'auto.components.automations.automation.templates.8a0228bea3',
      'Hourly queue check'
    ),
    description: translate(
      'auto.components.automations.automation.templates.37571fcb16',
      'Look for stuck work, stale generated files, and failed local validation.'
    ),
    name: translate(
      'auto.components.automations.automation.templates.maintenance.name',
      'Hourly maintenance check'
    ),
    prompt: translate(
      'auto.components.automations.automation.templates.maintenance.prompt',
      'Check for stuck work, stale generated files, failing validation, and anything that needs human attention. Report only actionable issues.'
    ),
    preset: 'hourly',
    time: '00:15',
    missedRunGraceMinutes: '30'
  },
  {
    id: 'avenapm-ticket-hourly',
    category: translate(
      'auto.components.automations.automation.templates.avenapmTicket.category',
      'Avena PM'
    ),
    label: translate(
      'auto.components.automations.automation.templates.avenapmTicket.label',
      'Automatic ticket'
    ),
    description: translate(
      'auto.components.automations.automation.templates.avenapmTicket.description',
      'Each hour, take the next unowned ticket from the queue and run it through the Harness ticket flow up to the PR.'
    ),
    name: translate(
      'auto.components.automations.automation.templates.avenapmTicket.name',
      'Automatic Avena PM ticket'
    ),
    prompt: translate(
      'auto.components.automations.automation.templates.avenapmTicket.prompt',
      'Take the next ticket from the Avena PM operations queue and resolve it with the Harness flow «Ticket automático (Avena PM)».\n1. List the queue with `listar_tareas_cola`. Pick the oldest ticket in «Por hacer», with no owner, that belongs to this repository. If there is none, reply «Sin tickets» and stop without starting anything.\n2. Start the flow in this workspace: `topo harness start --flow avenapm-ticket --field ticket=<ID> --field correo=<your-email>` (use `$TOPO_CLI_COMMAND` if `topo` is not on the PATH). Replace <your-email> in this prompt with the email you take tickets with.\n3. Follow the protocol it prints until the flow ends: `topo harness status`, do the task, report it with `topo harness complete`, and run `topo harness wait` while Topo runs steps with other agents.\nNobody will answer questions during this run: never wait for a person. When the flow cannot go on, it comments and pauses the ticket on its own.'
    ),
    preset: 'hourly',
    time: '00:05',
    agentId: 'claude',
    missedRunGraceMinutes: '30',
    // One workspace per ticket, so parallel tickets never share a branch.
    workspaceMode: 'new_per_run'
  }
])
