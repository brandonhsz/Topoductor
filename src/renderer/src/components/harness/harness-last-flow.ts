const LAST_FLOW_KEY = 'topo.harness.lastFlowByRepo'

function readLastFlows(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_FLOW_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

/** The Harness flow last picked for `repoId` in Create worktree; null when none or "None". */
export function rememberedHarnessFlowId(repoId: string): string | null {
  const value = readLastFlows()[repoId]
  return typeof value === 'string' && value ? value : null
}

export function rememberHarnessFlow(repoId: string, flowId: string | null): void {
  try {
    localStorage.setItem(LAST_FLOW_KEY, JSON.stringify({ ...readLastFlows(), [repoId]: flowId }))
  } catch {
    // A private window only loses the remembered choice.
  }
}
