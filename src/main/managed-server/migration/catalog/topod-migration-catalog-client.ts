import { hasModernAutomationLaunchSetup } from '../../../../shared/automations/launch/automation-launch-setup'
import { automationCanonicalLaunchSetup } from '../../../../shared/automations/launch/automation-canonical-launch-setup'
import { AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY } from '../../../../shared/automations/automation-runtime-capabilities'
import {
  parseTopodMigrationCatalogAbortResult,
  parseTopodMigrationCatalogState
} from '../../../../shared/topod-migration/topod-migration-catalog-state'

import type {
  TopodMigrationCatalogAbortResult,
  TopodMigrationCatalogState,
  TopodMigrationManifest
} from '../../../../shared/topod-migration/topod-migration-manifest'

import {
  findUnsupportedMigrationBlobKind,
  topodMigrationBlobKindUnsupportedBlocker
} from '../../../../shared/topod-migration/topod-migration-blob-transfer'

import type { TopodMigrationBlobDescriptor } from '../../../../shared/topod-migration/topod-migration-blob-transfer'
import { topodMigrationManifestBlobs } from '../../../../shared/topod-migration/topod-migration-automation-run-history'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import { assertTopodMigrationRequestFits } from './topod-migration-request-budget'
import { hasExtraAgentArgs } from '../../../../shared/agent-launch/startup/automation-extra-agent-args'
import { requiredTopodMigrationSourceCapability } from '../../../../shared/topod-migration/topod-migration-source-kind'
import type { CatalogRequestOptions } from './topod-migration-request'
import { sendSupportedMigrationRequest } from './topod-migration-request'

type TopodCatalogMigrationOperation = 'abort' | 'commit' | 'stage' | 'state'

const METHOD_BY_OPERATION: Record<TopodCatalogMigrationOperation, string> = {
  abort: 'topod.migration.abortCatalog',
  commit: 'topod.migration.commitCatalog',
  stage: 'topod.migration.stageCatalog',
  state: 'topod.migration.catalogState'
}

export function stageRemoteTopodMigrationCatalog(
  pairingCode: string,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'stage', manifest, options)
}

/** Expected blobs make the destination refuse incomplete commits. */
export async function commitRemoteTopodMigrationCatalog(
  pairingCode: string,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions & {
    expectedBlobs?: readonly TopodMigrationBlobDescriptor[]
  } = {}
): Promise<TopodMigrationCatalogState> {
  const result = await request(pairingCode, 'commit', manifest, options, options.expectedBlobs)
  return parseTopodMigrationCatalogState(result, manifest)
}

export function readRemoteTopodMigrationCatalogState(
  pairingCode: string,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'state', manifest, options)
}

export async function abortRemoteTopodMigrationCatalog(
  pairingCode: string,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<TopodMigrationCatalogAbortResult> {
  const result = await request(pairingCode, 'abort', manifest, options)
  const parsed = parseTopodMigrationCatalogAbortResult(result, manifest)
  // Older already-absent replies prove no durability, unlike real aborts.
  if (parsed.state === 'absent' && !parsed.aborted && parsed.durableAbsent !== true) {
    throw new Error('topod_migration_abort_durability_unverifiable:destination_update_required')
  }
  return parsed
}

async function requestCatalogState(
  pairingCode: string,
  operation: Exclude<TopodCatalogMigrationOperation, 'abort'>,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions
): Promise<TopodMigrationCatalogState> {
  const result = await request(pairingCode, operation, manifest, options)
  return parseTopodMigrationCatalogState(result, manifest)
}

async function request(
  pairingCode: string,
  operation: TopodCatalogMigrationOperation,
  manifest: TopodMigrationManifest,
  options: CatalogRequestOptions,
  expectedBlobs: readonly TopodMigrationBlobDescriptor[] = []
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('topod_migration_pairing_code_invalid')
  }
  // Preserve exact { manifest } wire shape for blob-free and SSH moves.
  const params = expectedBlobs.length > 0 ? { manifest, expectedBlobs } : { manifest }
  // Validation-size limits can exceed sealed-frame capacity; reject before the host closes the socket.
  assertTopodMigrationRequestFits(params)
  const imports = operation === 'stage' || operation === 'commit'
  const carriesExtraAgentArgs =
    imports &&
    (manifest.payload.dormantState?.automations ?? []).some((automation) =>
      hasExtraAgentArgs(automation.extraAgentArgs)
    )
  // An older host would drop the blob a manifest names and import without its rows.
  const requiredBlobs = imports
    ? [...expectedBlobs, ...topodMigrationManifestBlobs(manifest)]
    : expectedBlobs
  const response = await sendSupportedMigrationRequest(
    pairing,
    METHOD_BY_OPERATION[operation],
    params,
    options,
    carriesExtraAgentArgs,
    // Recheck source capabilities on every operation; older hosts may misparse non-SSH sources.
    requiredTopodMigrationSourceCapability(manifest.source),
    // Hosts without blob capability would strip expectedBlobs and commit unchecked.
    (capabilities) => {
      if (
        imports &&
        (manifest.payload.dormantState?.automations ?? []).some((automation) =>
          hasModernAutomationLaunchSetup(automationCanonicalLaunchSetup(automation))
        ) &&
        !capabilities.includes(AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY)
      ) {
        throw new Error(
          'Update Topo on the destination host to keep automation agent launch settings.'
        )
      }
      const unsupported = findUnsupportedMigrationBlobKind(requiredBlobs, capabilities)
      if (unsupported) {
        throw new Error(topodMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`topod_migration_${operation}_failed:${response.error.message}`)
  }
  return response.result
}
