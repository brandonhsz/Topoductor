import type { HarnessFlow } from '../../shared/harness/harness-flow-types'
import type {
  HarnessFlowAuthor,
  HarnessFlowVersion,
  HarnessFlowVersionSummary
} from '../../shared/harness/harness-flow-version-types'

export const MAX_VERSIONS_PER_FLOW = 200

function notImplemented(): never {
  throw new Error('not_implemented')
}

export async function listHarnessFlowVersions(
  _flowId: string
): Promise<HarnessFlowVersionSummary[]> {
  return notImplemented()
}

export async function getHarnessFlowVersion(
  _flowId: string,
  _versionId: string
): Promise<HarnessFlowVersion | null> {
  return notImplemented()
}

export async function recordHarnessFlowVersion(_input: {
  flow: HarnessFlow
  author: HarnessFlowAuthor
  summary: string
}): Promise<HarnessFlowVersionSummary> {
  return notImplemented()
}

export async function deleteHarnessFlowVersions(_flowId: string): Promise<void> {
  return notImplemented()
}
