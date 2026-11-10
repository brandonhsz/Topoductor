import { AutomationCanonicalLaunchSetup } from '../rpc-contract/automation-params'
import { automationCanonicalDefinition } from '../automations/launch/automation-launch-setup'
import { assertAutomationExtraAgentArgs } from '../automations/launch/automation-extra-agent-args-record'
import { isTuiAgent } from '../agent-launch/catalog/tui-agent-config'
import type { Automation } from '../automations/automation-definition'
import type { AutomationRun } from '../automations/history/automation-run'
import { getAutomationRunRepoId } from '../automations/history/automation-run-identity'
import { TOPOD_MIGRATION_BLOB_KIND_CONTRACTS } from './topod-migration-blob-transfer'
import type { TopodMigrationAutomationRunHistoryRef } from './topod-migration-manifest'
import {
  assertUnique,
  boundedArray,
  optionalFinite,
  optionalNullableString,
  optionalPositiveInteger,
  requiredBoolean,
  requiredFinite,
  requiredRecord,
  requiredString,
  requiredStringOrEmpty
} from './topod-migration-dormant-value-validation'
import {
  parseOutputSnapshot,
  parsePrecheck,
  parsePrecheckResult,
  parseUsage
} from './topod-migration-dormant-automation-fields'

const FINAL_RUN_STATUSES = new Set<unknown>([
  'completed',
  'dispatch_failed',
  'skipped_precheck',
  'skipped_missed',
  'skipped_unavailable',
  'skipped_needs_interactive_auth'
])

export function parseTopodMigrationDormantAutomations(value: unknown): Automation[] {
  const automations = boundedArray(value, parseAutomation, 'automations')
  assertUnique(automations, (entry) => entry.id, 'automation')
  return automations
}

export function parseTopodMigrationDormantAutomationRuns(value: unknown): AutomationRun[] {
  const runs = boundedArray(value, parseAutomationRun, 'automation_runs')
  assertUnique(runs, (entry) => entry.id, 'automation_run')
  return runs
}

export function parseTopodMigrationAutomationRunHistoryRef(
  value: unknown
): TopodMigrationAutomationRunHistoryRef {
  const record = requiredRecord(value, 'topod_migration_dormant_automation_run_history_invalid')
  const { sha256, byteLength } = record
  if (
    typeof sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > TOPOD_MIGRATION_BLOB_KIND_CONTRACTS['automation-run-history'].maxBytes
  ) {
    throw new Error('topod_migration_dormant_automation_run_history_invalid')
  }
  return { sha256, byteLength }
}

export function assertTopodMigrationDormantAutomationReferences(args: {
  automations: readonly Automation[]
  automationRuns: readonly AutomationRun[]
  repositoryIds: ReadonlySet<string>
  owns: (value: string) => boolean
}): void {
  const automationIds = new Set(args.automations.map((entry) => entry.id))
  for (const automation of args.automations) {
    const repoId = getAutomationRunRepoId(automation)
    if (
      !args.repositoryIds.has(repoId) ||
      !contextBelongsToDestination(automation.runContext, args.repositoryIds) ||
      !contextBelongsToDestination(automation.sourceContext, args.repositoryIds) ||
      (automation.workspaceId !== null && !args.owns(automation.workspaceId))
    ) {
      throw new Error('topod_migration_dormant_automation_scope_invalid')
    }
  }
  for (const run of args.automationRuns) {
    if (
      !automationIds.has(run.automationId) ||
      !contextBelongsToDestination(run.runContext, args.repositoryIds) ||
      !contextBelongsToDestination(run.sourceContext, args.repositoryIds) ||
      (run.workspaceId !== null && !args.owns(run.workspaceId))
    ) {
      throw new Error('topod_migration_dormant_automation_run_scope_invalid')
    }
  }
}

function parseAutomation(value: unknown): Automation {
  const copy = structuredClone(value)
  if (!isMigratedAutomation(copy)) {
    throw new Error('topod_migration_dormant_automation_invalid')
  }
  // A disallowed flag or Reuse with extras would otherwise persist and fail every later run.
  try {
    assertAutomationExtraAgentArgs(copy)
  } catch {
    throw new Error('topod_migration_dormant_automation_extra_agent_args_invalid')
  }
  return automationCanonicalDefinition(copy)
}

/** Throws the specific field error; narrowing only follows these checks. */
function isMigratedAutomation(value: unknown): value is Automation {
  const record = requiredRecord(value, 'topod_migration_dormant_automation_invalid')
  requiredString(record.id, 'topod_migration_dormant_automation_id_invalid')
  requiredString(record.name, 'topod_migration_dormant_automation_name_invalid')
  requiredStringOrEmpty(record.prompt, 'topod_migration_dormant_automation_prompt_invalid')
  parsePrecheck(record.precheck)
  if (!isTuiAgent(record.agentId)) {
    throw new Error('topod_migration_dormant_automation_agent_invalid')
  }
  if (record.surface !== undefined && record.surface !== 'chat' && record.surface !== 'terminal') {
    throw new Error('topod_migration_dormant_automation_surface_invalid')
  }
  if (record.extraAgentArgs !== undefined && typeof record.extraAgentArgs !== 'string') {
    throw new Error('topod_migration_dormant_automation_extra_agent_args_invalid')
  }
  AutomationCanonicalLaunchSetup.parse({
    ...(record.launchPreferences !== undefined
      ? { launchPreferences: record.launchPreferences }
      : {}),
    ...(record.agentArgs !== undefined ? { agentArgs: record.agentArgs } : {})
  })
  if (record.launchSetup !== undefined) {
    AutomationCanonicalLaunchSetup.parse(record.launchSetup)
  }
  parseContext(record.runContext, 'workspace-run')
  parseContext(record.sourceContext, 'task-source')
  requiredString(record.projectId, 'topod_migration_dormant_automation_project_invalid')
  if (
    record.executionTargetType !== 'local' ||
    record.executionTargetId !== 'local' ||
    record.executionTargetGeneration !== undefined ||
    record.schedulerOwner !== 'remote_host_service' ||
    record.enabled !== false
  ) {
    throw new Error('topod_migration_dormant_automation_owner_invalid')
  }
  if (!['existing', 'new_per_run'].includes(String(record.workspaceMode))) {
    throw new Error('topod_migration_dormant_automation_workspace_mode_invalid')
  }
  optionalNullableString(record.workspaceId, 'topod_migration_dormant_automation_workspace_invalid')
  optionalNullableString(record.baseBranch, 'topod_migration_dormant_automation_branch_invalid')
  if (
    record.setupDecision !== undefined &&
    record.setupDecision !== 'run' &&
    record.setupDecision !== 'skip'
  ) {
    throw new Error('topod_migration_dormant_automation_setup_decision_invalid')
  }
  requiredBoolean(record.reuseSession, 'topod_migration_dormant_automation_reuse_invalid')
  requiredString(record.timezone, 'topod_migration_dormant_automation_timezone_invalid')
  requiredString(record.rrule, 'topod_migration_dormant_automation_rrule_invalid')
  for (const field of [
    'dtstart',
    'nextRunAt',
    'missedRunGraceMinutes',
    'createdAt',
    'updatedAt'
  ] as const) {
    requiredFinite(record[field], `topod_migration_dormant_automation_${field}_invalid`)
  }
  optionalFinite(record.lastRunAt, 'topod_migration_dormant_automation_last_run_invalid')
  if (record.missedRunPolicy !== 'run_once_within_grace') {
    throw new Error('topod_migration_dormant_automation_missed_policy_invalid')
  }
  return true
}

function parseAutomationRun(value: unknown): AutomationRun {
  const copy = structuredClone(value)
  if (!isMigratedAutomationRun(copy)) {
    throw new Error('topod_migration_dormant_automation_run_invalid')
  }
  return copy
}

/** Throws the specific field error; narrowing only follows these checks. */
function isMigratedAutomationRun(value: unknown): value is AutomationRun {
  const record = requiredRecord(value, 'topod_migration_dormant_automation_run_invalid')
  requiredString(record.id, 'topod_migration_dormant_automation_run_id_invalid')
  requiredString(record.automationId, 'topod_migration_dormant_automation_run_owner_invalid')
  AutomationCanonicalLaunchSetup.parse({
    ...(record.launchPreferences !== undefined
      ? { launchPreferences: record.launchPreferences }
      : {}),
    ...(record.agentArgs !== undefined ? { agentArgs: record.agentArgs } : {})
  })
  parseContext(record.runContext, 'workspace-run')
  parseContext(record.sourceContext, 'task-source')
  requiredString(record.title, 'topod_migration_dormant_automation_run_title_invalid')
  requiredFinite(record.scheduledFor, 'topod_migration_dormant_automation_run_schedule_invalid')
  if (!FINAL_RUN_STATUSES.has(record.status)) {
    throw new Error('topod_migration_dormant_automation_run_status_invalid')
  }
  if (record.trigger !== 'scheduled' && record.trigger !== 'manual') {
    throw new Error('topod_migration_dormant_automation_run_trigger_invalid')
  }
  optionalNullableString(
    record.workspaceId,
    'topod_migration_dormant_automation_run_workspace_invalid'
  )
  optionalNullableString(
    record.workspaceDisplayName,
    'topod_migration_dormant_automation_run_workspace_name_invalid'
  )
  if (record.sessionKind !== 'terminal' && record.sessionKind !== 'chat') {
    throw new Error('topod_migration_dormant_automation_run_session_invalid')
  }
  for (const field of [
    'chatSessionId',
    'terminalSessionId',
    'terminalPaneKey',
    'terminalPtyId',
    'error'
  ] as const) {
    optionalNullableString(record[field], `topod_migration_dormant_automation_run_${field}_invalid`)
  }
  if (
    record.sessionKind === 'chat' &&
    [record.terminalSessionId, record.terminalPaneKey, record.terminalPtyId].some(
      (value) => value != null
    )
  ) {
    throw new Error('topod_migration_dormant_automation_run_session_invalid')
  }
  if (record.sessionKind === 'terminal' && record.chatSessionId != null) {
    throw new Error('topod_migration_dormant_automation_run_session_invalid')
  }
  parseOutputSnapshot(record.outputSnapshot)
  parsePrecheckResult(record.precheckResult)
  parseUsage(record.usage)
  optionalFinite(record.startedAt, 'topod_migration_dormant_automation_run_started_invalid', true)
  optionalFinite(
    record.dispatchedAt,
    'topod_migration_dormant_automation_run_dispatched_invalid',
    true
  )
  requiredFinite(record.createdAt, 'topod_migration_dormant_automation_run_created_invalid')
  optionalPositiveInteger(record.runNumber, 'topod_migration_dormant_automation_run_number_invalid')
  optionalPositiveInteger(
    record.occurrenceCount,
    'topod_migration_dormant_automation_occurrence_count_invalid'
  )
  optionalFinite(
    record.lastOccurrenceAt,
    'topod_migration_dormant_automation_last_occurrence_invalid'
  )
  return true
}

function parseContext(value: unknown, kind: 'workspace-run' | 'task-source'): void {
  if (value === undefined || value === null) {
    return
  }
  const record = requiredRecord(value, 'topod_migration_dormant_automation_context_invalid')
  if (record.kind !== kind || record.hostId !== 'local') {
    throw new Error('topod_migration_dormant_automation_context_owner_invalid')
  }
  requiredString(record.projectId, 'topod_migration_dormant_automation_context_project_invalid')
  optionalNullableString(
    record.projectHostSetupId,
    'topod_migration_dormant_automation_context_setup_invalid'
  )
  optionalNullableString(record.repoId, 'topod_migration_dormant_automation_context_repo_invalid')
  if (kind === 'workspace-run') {
    requiredString(
      record.projectHostSetupId,
      'topod_migration_dormant_automation_context_setup_invalid'
    )
    requiredString(record.repoId, 'topod_migration_dormant_automation_context_repo_invalid')
    requiredString(record.path, 'topod_migration_dormant_automation_context_path_invalid')
  } else if (!['github', 'gitlab', 'linear', 'jira'].includes(String(record.provider))) {
    throw new Error('topod_migration_dormant_automation_context_provider_invalid')
  }
}

function contextBelongsToDestination(
  context: Automation['runContext'] | Automation['sourceContext'],
  repositoryIds: ReadonlySet<string>
): boolean {
  if (!context) {
    return true
  }
  if (context.hostId !== 'local') {
    return false
  }
  if (context.repoId && !repositoryIds.has(context.repoId)) {
    return false
  }
  return !context.projectHostSetupId || context.projectHostSetupId === context.repoId
}
