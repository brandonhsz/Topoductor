export type SmartWorkspaceCommandRowKind =
  | 'use-name'
  | 'create-branch'
  | 'github'
  | 'gitlab'
  | 'branch'
  | 'linear'
  | 'jira'
  | 'avenapm'
  | 'jira-account'

export type SmartWorkspaceCommandRow = {
  kind: SmartWorkspaceCommandRowKind
  value: string
}

export type SmartWorkspaceSourceIntent = 'github' | 'gitlab' | 'linear' | 'jira' | 'avenapm' | null

export function resolveSmartWorkspaceCommandValue({
  currentValue,
  rows,
  isQueryStale,
  sourceIntent
}: {
  currentValue: string
  rows: readonly SmartWorkspaceCommandRow[]
  isQueryStale: boolean
  sourceIntent: SmartWorkspaceSourceIntent
}): string {
  if (rows.length === 0) {
    return currentValue
  }

  // Keep selection stable while live text leads debounced results, avoiding highlight changes on each keystroke.
  if (isQueryStale) {
    const typedTextRow = rows.find((row) => row.kind === 'use-name' || row.kind === 'create-branch')
    if (typedTextRow) {
      return typedTextRow.value
    }
    return rows.some((row) => row.value === currentValue) ? currentValue : (rows[0]?.value ?? '')
  }

  const intentRow = sourceIntent ? rows.find((row) => row.kind === sourceIntent) : undefined
  if (intentRow) {
    return intentRow.value
  }

  return rows.some((row) => row.value === currentValue) ? currentValue : rows[0].value
}
