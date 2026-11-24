export const HARNESS_FLOW_ERROR_CODES = [
  'harness_no_workspace',
  'harness_flow_not_found',
  'harness_flow_scope_forbidden',
  'harness_flow_invalid',
  'harness_flow_conflict',
  'harness_flow_limit',
  'harness_flows_unreadable',
  'harness_flow_version_invalid',
  'harness_flow_version_not_found',
  'harness_flow_versions_unreadable'
] as const

export type HarnessFlowErrorCode = (typeof HARNESS_FLOW_ERROR_CODES)[number]

/** Carries its code to RPC callers, so an agent can react to a conflict without parsing text. */
export class HarnessFlowError extends Error {
  readonly code: HarnessFlowErrorCode

  constructor(code: HarnessFlowErrorCode, detail: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options)
    this.name = 'HarnessFlowError'
    this.code = code
  }
}
