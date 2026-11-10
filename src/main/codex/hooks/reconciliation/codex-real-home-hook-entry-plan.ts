import { removeManagedCommands } from '../../../agent-hooks/installation/commands/managed-hook-command-matching'
import type {
  HookCommandConfig,
  HookDefinition
} from '../../../agent-hooks/installation/configuration/hook-config-schema'
import {
  buildCodexManagedHook,
  CODEX_EVENT_LABEL,
  type CodexManagedHookInstallMaterial
} from '../definitions/codex-hook-definition'
import {
  CODEX_HOOK_COMMAND_FORM,
  readCodexHookCommandForm
} from '../definitions/codex-hook-command-form'
import { createCodexHookTrustEntry } from '../definitions/codex-hook-identity'
import type { CodexEventLabel, CodexTrustEntry } from '../../trust/toml/config-toml-trust'

type HooksByEvent = Record<string, HookDefinition[]>

// Codex hashes group matchers, so Topo needs a dedicated matcher-free group to match its approval.
export type RealHomeCodexHookEntryPlan =
  /** Pruning can shift user hooks and their positional approval keys. */
  | { kind: 'prune'; hooks: HooksByEvent }
  | {
      kind: 'settle'
      /** Preserve user hook positions. */
      hooks: HooksByEvent
      /** Existing approvals may be stale for these events. */
      changedLabels: ReadonlySet<CodexEventLabel>
      managedEntries: CodexTrustEntry[]
      /** Preserve newer entries and older forms not being converted. */
      untouchedLabels: ReadonlySet<CodexEventLabel>
    }

type TopoHandler = {
  groupIndex: number
  hook: HookCommandConfig
  form: number
}

function findTopoHandlers(
  definitions: HookDefinition[],
  isTopoCommand: (command: string | undefined) => boolean,
  command: string
): TopoHandler[] {
  return definitions.flatMap((definition, groupIndex) =>
    Array.isArray(definition.hooks)
      ? definition.hooks.flatMap((hook) =>
          isTopoCommand(hook.command)
            ? [{ groupIndex, hook, form: readCodexHookCommandForm(hook.command, command) }]
            : []
        )
      : []
  )
}

function isTopoOnlyGroup(
  definition: HookDefinition,
  isTopoCommand: (command: string | undefined) => boolean
): boolean {
  return (
    Object.keys(definition).every((key) => key === 'hooks') &&
    Array.isArray(definition.hooks) &&
    definition.hooks.every((hook) => isTopoCommand(hook.command))
  )
}

// Match every field Codex hashes so modified hooks cannot reuse Topo's approval.
function isSameHook(left: HookCommandConfig, right: HookCommandConfig): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]))
}

function isSameList(left: HookDefinition[], right: HookDefinition[]): boolean {
  return (
    left.length === right.length && left.every((definition, index) => definition === right[index])
  )
}

export function planRealHomeCodexHookEntries(args: {
  hooks: HooksByEvent
  sourcePath: string
  material: Pick<CodexManagedHookInstallMaterial, 'events' | 'command'>
  isTopoCommand: (command: string | undefined) => boolean
  /** Convert older forms at startup/opt-in, never on launch. */
  convertOlderForms: boolean
}): RealHomeCodexHookEntryPlan {
  const { material, isTopoCommand, sourcePath } = args
  const command = material.command
  // Preserve unplanned events, which may belong to a newer build.
  const pruned: HooksByEvent = { ...args.hooks }
  const hooks: HooksByEvent = { ...args.hooks }
  const changedLabels = new Set<CodexEventLabel>()
  const untouchedLabels = new Set<CodexEventLabel>()
  const managedEntries: CodexTrustEntry[] = []
  let prunedChanged = false

  for (const eventName of material.events) {
    const label = CODEX_EVENT_LABEL[eventName]
    const current = Array.isArray(args.hooks[eventName]) ? args.hooks[eventName] : []
    const handlers = findTopoHandlers(current, isTopoCommand, command)
    const holdsOlderForm =
      current.some((definition) =>
        [definition.command, definition.bash, definition.powershell].some(isTopoCommand)
      ) || handlers.some((handler) => handler.hook.command !== command)
    if (
      handlers.some((handler) => handler.form > CODEX_HOOK_COMMAND_FORM) ||
      (holdsOlderForm && !args.convertOlderForms)
    ) {
      untouchedLabels.add(label)
      continue
    }
    const keeper = handlers.find((handler) =>
      isTopoOnlyGroup(current[handler.groupIndex]!, isTopoCommand)
    )
    const rest = removeManagedCommands(current, isTopoCommand)
    // Keep the surviving group in place to preserve user approval keys.
    const slot = keeper
      ? removeManagedCommands(current.slice(0, keeper.groupIndex), isTopoCommand).length
      : rest.length
    const keptGroup = keeper && current[keeper.groupIndex]!
    const prunedDefinitions = keptGroup
      ? [
          ...rest.slice(0, slot),
          keptGroup.hooks!.length === 1 ? keptGroup : { hooks: [keeper.hook] },
          ...rest.slice(slot)
        ]
      : rest
    if (!isSameList(prunedDefinitions, current)) {
      pruned[eventName] = prunedDefinitions
      prunedChanged = true
      continue
    }
    const wanted = buildCodexManagedHook(command, eventName)
    const definitions =
      keeper && isSameHook(keeper.hook, wanted)
        ? current
        : [...current.slice(0, slot), { hooks: [wanted] }, ...current.slice(slot + 1)]
    if (definitions !== current) {
      hooks[eventName] = definitions
      changedLabels.add(label)
    }
    const entry = createCodexHookTrustEntry(
      sourcePath,
      eventName,
      slot,
      0,
      definitions[slot]!,
      definitions[slot]!.hooks![0]!
    )
    if (entry) {
      managedEntries.push(entry)
    }
  }

  return prunedChanged
    ? { kind: 'prune', hooks: pruned }
    : { kind: 'settle', hooks, changedLabels, managedEntries, untouchedLabels }
}
