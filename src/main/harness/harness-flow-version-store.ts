import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { normalizeHarnessFlow } from '../../shared/harness/harness-flow-normalize'
import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import {
  HARNESS_FLOW_VERSION_SUMMARY_MAX,
  type HarnessFlowAuthor,
  type HarnessFlowVersion,
  type HarnessFlowVersionSummary
} from '../../shared/harness/harness-flow-version-types'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'
import { createHarnessSerialQueue } from './harness-serial-queue'

export const MAX_VERSIONS_PER_FLOW = 200

type VersionsFile = {
  version: 1
  /** Oldest first. */
  versions: HarnessFlowVersion[]
}

const SAFE_FLOW_ID = /^[A-Za-z0-9_-]+$/

function historyPath(flowId: string): string {
  if (!SAFE_FLOW_ID.test(flowId)) {
    throw new Error('harness_flow_version_invalid: unsafe flow id')
  }
  return join(getAppEnvironment().getPath('userData'), 'harness-flow-versions', `${flowId}.json`)
}

function storedVersion(raw: unknown, flowId: string): HarnessFlowVersion | null {
  const record = asRecord(raw)
  const flow = normalizeHarnessFlow(record?.flow)
  if (
    !record ||
    !flow ||
    typeof record.id !== 'string' ||
    record.flowId !== flowId ||
    typeof record.createdAt !== 'number' ||
    (record.author !== 'person' && record.author !== 'agent') ||
    typeof record.summary !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    flowId,
    createdAt: record.createdAt,
    author: record.author,
    summary: record.summary,
    flow
  }
}

/** Throws instead of returning empty: rewriting an unreadable file would drop its history. */
async function readVersions(flowId: string): Promise<HarnessFlowVersion[]> {
  let contents: string
  try {
    contents = await readFile(historyPath(flowId), 'utf8')
  } catch (error) {
    if (asRecord(error)?.code === 'ENOENT') {
      return []
    }
    throw new Error('harness_flow_versions_unreadable', { cause: error })
  }
  let parsed: Record<string, unknown> | null
  try {
    parsed = asRecord(JSON.parse(contents))
  } catch (error) {
    throw new Error('harness_flow_versions_unreadable', { cause: error })
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.versions)) {
    throw new Error('harness_flow_versions_unreadable')
  }
  return parsed.versions
    .map((raw) => storedVersion(raw, flowId))
    .filter((version): version is HarnessFlowVersion => version !== null)
}

function withoutFlow({ flow: _flow, ...summary }: HarnessFlowVersion): HarnessFlowVersionSummary {
  return summary
}

const serialized = createHarnessSerialQueue()

/** Newest first. */
export function listHarnessFlowVersions(flowId: string): Promise<HarnessFlowVersionSummary[]> {
  return serialized(async () => (await readVersions(flowId)).map(withoutFlow).toReversed())
}

export function getHarnessFlowVersion(
  flowId: string,
  versionId: string
): Promise<HarnessFlowVersion | null> {
  return serialized(
    async () => (await readVersions(flowId)).find((version) => version.id === versionId) ?? null
  )
}

export function recordHarnessFlowVersion(input: {
  flow: HarnessFlow
  author: HarnessFlowAuthor
  summary: string
}): Promise<HarnessFlowVersionSummary> {
  return serialized(async () => {
    const summary = input.summary.trim()
    if (!summary || summary.length > HARNESS_FLOW_VERSION_SUMMARY_MAX) {
      throw new Error(
        `harness_flow_version_invalid: summary must be 1-${HARNESS_FLOW_VERSION_SUMMARY_MAX} characters`
      )
    }
    const flowId = input.flow.id
    const versions = await readVersions(flowId)
    const version: HarnessFlowVersion = {
      id: randomUUID(),
      flowId,
      createdAt: Date.now(),
      author: input.author,
      summary,
      flow: input.flow
    }
    const file: VersionsFile = {
      version: 1,
      versions: [...versions, version].slice(-MAX_VERSIONS_PER_FLOW)
    }
    writeSecureJsonFile(historyPath(flowId), file)
    return withoutFlow(version)
  })
}

export function deleteHarnessFlowVersions(flowId: string): Promise<void> {
  return serialized(() => rm(historyPath(flowId), { force: true }))
}
