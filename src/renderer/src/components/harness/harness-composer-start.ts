import { resolveQuickCreateLinkedWorkItemPrompt } from '@/lib/linked-work-item-context'
import { harnessChatInstructions } from '../../../../shared/harness/harness-chat-instructions'
import type { HarnessFlow, HarnessStartField } from '../../../../shared/harness/harness-flow-types'

/** A select left on this value is deduced from the task source at create time. */
export const HARNESS_AUTO_OPTION = '__auto__'

export type HarnessComposerChoice = {
  flow: HarnessFlow
  /** Empty text or HARNESS_AUTO_OPTION means "take it from the source". */
  fields: Record<string, string>
}

export type HarnessTaskSource = {
  title: string | null
  url: string | null
  workspaceName: string
}

const TYPE_PATTERNS: [RegExp, string][] = [
  [/\b(bug|fix|hotfix|error|falla|arregl|crash|regresi|incendio|broken|roto)/i, 'bug'],
  [/\b(refactor|limpi|cleanup|clean up|reorganiz|migra)/i, 'refactor'],
  [/\b(investig|research|spike|analiz|explor|why|por qu[eé])/i, 'investigacion']
]

/** The option a title points to (bug, refactor, investigación), or the field's first option. */
export function deduceHarnessOption(field: HarnessStartField, text: string): string {
  const options = field.options
  for (const [pattern, kind] of TYPE_PATTERNS) {
    const option = options.find((candidate) => candidate.toLowerCase().startsWith(kind.slice(0, 6)))
    if (option && pattern.test(text)) {
      return option
    }
  }
  return options.find((option) => option.toLowerCase() === 'feature') ?? options[0] ?? ''
}

function startFields(flow: HarnessFlow): HarnessStartField[] {
  const start = flow.nodes.find((node) => node.kind === 'start')
  return start?.kind === 'start' ? start.fields : []
}

/** Fills what the person left for Topo: the intent from the source, selects by deduction. */
export function resolveHarnessFields(
  choice: HarnessComposerChoice,
  source: HarnessTaskSource
): Record<string, string> {
  const sourceText = [source.title, source.url].filter(Boolean).join('\n')
  const deductionText = source.title ?? source.workspaceName
  return Object.fromEntries(
    startFields(choice.flow).map((field) => {
      const given = choice.fields[field.key]?.trim() ?? ''
      if (field.options.length > 0) {
        return [
          field.key,
          given && given !== HARNESS_AUTO_OPTION ? given : deduceHarnessOption(field, deductionText)
        ]
      }
      if (given) {
        return [field.key, given]
      }
      return [field.key, field.optional ? '' : sourceText || source.workspaceName]
    })
  )
}

/** The chat's first message. Terminal agents get the protocol here, since only chats take system instructions. */
export function harnessKickoffMessage(
  flow: HarnessFlow,
  fields: Record<string, string>,
  withInstructions: boolean
): string {
  const context = startFields(flow)
    .filter((field) => fields[field.key]?.trim())
    .map((field) => `- **${field.label}:** ${fields[field.key]}`)
    .join('\n')
  const kickoff = [
    `Trabaja esta tarea siguiendo el flujo «${flow.name}».`,
    context,
    'Empieza corriendo `topo harness status` y sigue el protocolo del flujo.'
  ]
    .filter(Boolean)
    .join('\n\n')
  return withInstructions ? `${harnessChatInstructions(flow)}\n\n---\n\n${kickoff}` : kickoff
}

export type HarnessCreation = {
  start: { flowId: string; fields: Record<string, string> }
  /** First message for a chat, which already has the flow as system instructions. */
  kickoff: string
  /** First message for a terminal agent, which gets the protocol here instead. */
  terminalKickoff: string
}

/** The created agent's first message: a Harness kickoff, else the linked item's prompt or draft. */
export function resolveQuickCreationPrompt(args: {
  harness: HarnessCreation | null
  structuredLaunch: boolean
  linkedWorkItem: Parameters<typeof resolveQuickCreateLinkedWorkItemPrompt>[0]
  note: string
}): { prompt: string; draftPrompt: string | null } {
  if (!args.harness) {
    return resolveQuickCreateLinkedWorkItemPrompt(args.linkedWorkItem, args.note)
  }
  // Not routed through the note resolver: it treats notes as comments and would drop the kickoff.
  return {
    prompt: args.structuredLaunch ? args.harness.kickoff : args.harness.terminalKickoff,
    draftPrompt: null
  }
}

export function prepareHarnessCreation(
  choice: HarnessComposerChoice | null,
  linkedItem: { title: string; url: string } | null | undefined,
  workspaceName: string
): HarnessCreation | null {
  if (!choice) {
    return null
  }
  const fields = resolveHarnessFields(choice, {
    title: linkedItem?.title ?? null,
    url: linkedItem?.url ?? null,
    workspaceName
  })
  return {
    start: { flowId: choice.flow.id, fields },
    kickoff: harnessKickoffMessage(choice.flow, fields, false),
    terminalKickoff: harnessKickoffMessage(choice.flow, fields, true)
  }
}
