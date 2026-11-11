import { getLinkedWorkItemWorkspaceName } from '../../../../../shared/workspace-name'
import type { AvenaPMTask } from '../../../../../shared/avenapm/avenapm-types'

function ticketNumber(shortId: string | null): number {
  const match = shortId?.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

export function getAvenaPMTaskWorkspaceSeed(task: AvenaPMTask): string {
  const title = task.shortId ? `${task.shortId} ${task.title}` : task.title
  return (
    getLinkedWorkItemWorkspaceName({
      type: 'issue',
      provider: 'avenapm',
      number: ticketNumber(task.shortId),
      title
    })?.seedName ?? ''
  )
}

/** The «🎫 OP-142» opener makes the AvenaPM MCP's agents read the ticket with `leer_ticket` first. */
export function buildAvenaPMTaskPrompt(task: AvenaPMTask): string {
  const header = task.shortId ? `🎫 ${task.shortId} — ${task.title}` : task.title
  return [header, task.url].join('\n')
}
