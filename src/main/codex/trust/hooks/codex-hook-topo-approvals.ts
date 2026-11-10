import {
  MANAGED_HOOK_TIMEOUT_SECONDS,
  type HooksConfig
} from '../../../agent-hooks/installation/configuration/hook-config-schema'
import { readHooksJson } from '../../../agent-hooks/installation/configuration/hooks-json-read'
import {
  readHookTrustEntries,
  type CodexEventLabel,
  type CodexHookTrustState
} from '../toml/config-toml-trust'
import {
  computeCodexTrustKey as computeTrustKey,
  getExplicitHomeCodexHookSourcePath as getCodexExplicitHomeHookSourcePath
} from '../identity/codex-trust-identity'
import {
  CODEX_EVENTS,
  CODEX_EVENT_LABEL,
  computeTopoCodexHookHashes,
  getCodexConfigTomlPath,
  getConfigPath,
  getSystemCodexConfigTomlPath
} from '../../hooks/definitions/codex-hook-definition'
import { readEveryKnownCodexHookHashes } from './codex-hook-hash-lookup'
import { getSystemCodexHomePath } from '../../configuration/homes/codex-home-paths'
import { readLedgerTopoHashes } from '../grants/codex-managed-trust-reconciliation'
import {
  getRealHomeHookKeySourcePaths,
  getRealHomeHooksJsonPath
} from '../../hooks/reconciliation/codex-real-home-hooks-json'
import type { CodexHookHashes } from './codex-hook-trust-derivation'

export type CodexHookHome = {
  homePath: string
  hooksJsonPath: string
  tomlPath: string
  keySourcePaths: readonly [string, ...string[]]
}

export function getManagedCodexHookHome(runtimeHomePath: string): CodexHookHome {
  const hooksJsonPath = getConfigPath(runtimeHomePath)
  return {
    homePath: runtimeHomePath,
    hooksJsonPath,
    tomlPath: getCodexConfigTomlPath(runtimeHomePath),
    keySourcePaths: [getCodexExplicitHomeHookSourcePath(hooksJsonPath)]
  }
}

/** In-place homes keep user hooks and approvals in their original slots. */
export function getInPlaceCodexHookHome(homePath: string): CodexHookHome {
  const hooksJsonPath = getConfigPath(homePath)
  return {
    homePath,
    hooksJsonPath,
    tomlPath: getCodexConfigTomlPath(homePath),
    keySourcePaths: getRealHomeHookKeySourcePaths(hooksJsonPath)
  }
}

export function getRealHomeCodexHookHome(): CodexHookHome {
  return {
    homePath: getSystemCodexHomePath(),
    hooksJsonPath: getRealHomeHooksJsonPath(),
    tomlPath: getSystemCodexConfigTomlPath(),
    keySourcePaths: getRealHomeHookKeySourcePaths()
  }
}

type CodexEventName = (typeof CODEX_EVENTS)[number]
type TopoEntrySlot = { groupIndex: number; handlerIndex: number }
type TopoEntryApproval = CodexHookTrustState & { key: string; trustedHash: string }

export function findTopoEntrySlots(
  hooks: HooksConfig['hooks'],
  command: string
): Map<CodexEventName, TopoEntrySlot> {
  return new Map(
    CODEX_EVENTS.flatMap((eventName) => {
      const definitions = Array.isArray(hooks?.[eventName]) ? hooks[eventName] : []
      const slot = definitions.flatMap((definition, groupIndex) =>
        (definition.hooks ?? []).flatMap((hook, handlerIndex) =>
          hook.command === command ? [{ groupIndex, handlerIndex }] : []
        )
      )[0]
      return slot ? [[eventName, slot] as const] : []
    })
  )
}

/** Include approvals under every source-path spelling Codex uses. */
export function approvalsAtTopoEntries(
  trustStates: ReadonlyMap<string, CodexHookTrustState>,
  slots: ReadonlyMap<CodexEventName, TopoEntrySlot>,
  keySourcePaths: readonly string[],
  command: string
): Map<CodexEventLabel, TopoEntryApproval[]> {
  return new Map(
    [...slots].map(([eventName, slot]) => {
      const eventLabel = CODEX_EVENT_LABEL[eventName]
      const approvals = keySourcePaths.flatMap((sourcePath) => {
        const key = computeTrustKey({ sourcePath, eventLabel, command, ...slot })
        const state = trustStates.get(key)
        return state?.trustedHash ? [{ ...state, key, trustedHash: state.trustedHash }] : []
      })
      return [eventLabel, approvals]
    })
  )
}

// Positional keys may hold removed user hooks' approvals; only recognize known Topo hashes.
export function readKnownTopoHashes(home: CodexHookHome, command: string): CodexHookHashes[] {
  return [
    computeTopoCodexHookHashes(command),
    ...readEveryKnownCodexHookHashes(),
    ...readLedgerTopoHashes(home.homePath, command, MANAGED_HOOK_TIMEOUT_SECONDS)
  ]
}

export function isKnownTopoHash(
  knownTopoHashes: readonly CodexHookHashes[],
  eventLabel: CodexEventLabel,
  trustedHash: string | undefined
): boolean {
  return (
    trustedHash !== undefined &&
    knownTopoHashes.some((hashes) => hashes[eventLabel] === trustedHash)
  )
}

/** Until Codex answers, prefer existing known approvals over local hashes. */
export function readStopgapTopoHashes(home: CodexHookHome, command: string): CodexHookHashes {
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  try {
    trustStates = readHookTrustEntries(home.tomlPath)
  } catch {
    trustStates = new Map()
  }
  return findStopgapTopoHashes({
    trustStates,
    hooks: readHooksJson(home.hooksJsonPath)?.hooks,
    keySourcePaths: home.keySourcePaths,
    command,
    knownTopoHashes: readKnownTopoHashes(home, command)
  })
}

export function findStopgapTopoHashes(found: {
  trustStates: ReadonlyMap<string, CodexHookTrustState>
  hooks: HooksConfig['hooks']
  keySourcePaths: readonly string[]
  command: string
  knownTopoHashes: readonly CodexHookHashes[]
}): CodexHookHashes {
  const slots = findTopoEntrySlots(found.hooks, found.command)
  const approvals = approvalsAtTopoEntries(
    found.trustStates,
    slots,
    found.keySourcePaths,
    found.command
  )
  return {
    ...computeTopoCodexHookHashes(found.command),
    ...Object.fromEntries(
      [...approvals].flatMap(([eventLabel, held]) => {
        // Codex hashes content, so a known hash survives position changes.
        const approval = held.find(({ trustedHash }) =>
          isKnownTopoHash(found.knownTopoHashes, eventLabel, trustedHash)
        )
        return approval ? [[eventLabel, approval.trustedHash]] : []
      })
    )
  }
}
