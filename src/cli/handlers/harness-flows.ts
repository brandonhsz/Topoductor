import type { CommandHandler } from '../dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import type {
  HarnessFlowListItem,
  HarnessFlowReading,
  HarnessFlowSaveResult
} from '../../shared/harness/harness-flow-version-types'
import { callerParams, readCallerFile } from './harness-caller'

const SCOPES = ['global', 'repo'] as const

function formatFlowList(flows: HarnessFlowListItem[]): string {
  if (flows.length === 0) {
    return 'No Harness flows.'
  }
  return flows
    .map((flow) => {
      const scope = flow.scope.kind === 'global' ? 'global' : `repo ${flow.scope.repoId}`
      return `${flow.id}  ${flow.name}  (${scope}, ${flow.nodeCount} nodes, updatedAt ${flow.updatedAt})`
    })
    .join('\n')
}

function readingWarnings(reading: HarnessFlowReading): string[] {
  return [
    ...(reading.affectsAllRepos
      ? ['Global flow: a change reaches every repo without its own copy. Tell the person.']
      : []),
    ...(reading.activeRuns > 0
      ? [
          `${reading.activeRuns} run(s) in progress keep the copy they started with. Tell the person.`
        ]
      : [])
  ]
}

function formatFlowReading(reading: HarnessFlowReading): string {
  const problems = reading.problems.map((problem) => `- ${problem}`)
  const warnings = readingWarnings(reading).map((warning) => `- ${warning}`)
  return [
    reading.markdown,
    `updatedAt: ${reading.flow.updatedAt}`,
    ...(problems.length > 0 ? ['Problems:', ...problems] : []),
    ...(warnings.length > 0 ? ['Warnings:', ...warnings] : [])
  ].join('\n')
}

function formatFlowSave(result: HarnessFlowSaveResult): string {
  return [
    `Saved ${result.reading.flow.id} as version ${result.version.id}.`,
    formatFlowReading(result.reading)
  ].join('\n')
}

async function flowFromFile(path: string): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readCallerFile(path))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new RuntimeClientError('invalid_argument', `--file is not valid JSON: ${error.message}`)
    }
    throw error
  }
  const flow = asRecord(parsed)
  if (!flow) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--file must hold one HarnessFlow JSON object.'
    )
  }
  return flow
}

function scopeFlag(flags: Map<string, string | boolean>): (typeof SCOPES)[number] | undefined {
  const scope = getOptionalStringFlag(flags, 'scope')
  if (scope === undefined) {
    return undefined
  }
  const known = SCOPES.find((entry) => entry === scope)
  if (!known) {
    throw new RuntimeClientError('invalid_argument', '--scope must be global or repo.')
  }
  return known
}

export const HARNESS_FLOW_HANDLERS: Record<string, CommandHandler> = {
  'harness flow list': async ({ flags, client, json }) => {
    printResult(
      await client.call<HarnessFlowListItem[]>(
        'harness.flows.list',
        callerParams(flags, client.isRemote)
      ),
      json,
      formatFlowList
    )
  },
  'harness flow show': async ({ flags, client, json }) => {
    const flowId = getRequiredStringFlag(flags, 'flow')
    printResult(
      await client.call<HarnessFlowReading>('harness.flows.get', {
        ...callerParams(flags, client.isRemote),
        flowId
      }),
      json,
      formatFlowReading
    )
  },
  'harness flow save': async ({ flags, client, json }) => {
    const caller = callerParams(flags, client.isRemote)
    const summary = getRequiredStringFlag(flags, 'summary')
    const expectedUpdatedAt = getOptionalNonNegativeIntegerFlag(flags, 'expected-updated-at')
    const scope = scopeFlag(flags)
    const flow = await flowFromFile(getRequiredStringFlag(flags, 'file'))
    printResult(
      await client.call<HarnessFlowSaveResult>('harness.flows.save', {
        ...caller,
        flow,
        summary,
        ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
        ...(scope ? { scope } : {})
      }),
      json,
      formatFlowSave
    )
  }
}
