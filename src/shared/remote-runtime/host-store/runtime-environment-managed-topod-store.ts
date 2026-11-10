import { parsePairingCode } from '../pairing/pairing'
import type { PairingOffer } from '../pairing/mobile-relay-pairing-offer'
import {
  createEnvironmentFromPairingOffer,
  getPreferredLoopbackRuntimePort,
  getTopodSshDeployment,
  getPreferredPairingOffer,
  PersistedRuntimeEnvironmentSchema,
  type KnownRuntimeEnvironment,
  type TopodSshDeploymentLink
} from '../host-catalog/runtime-environments'
import {
  readEnvironmentStore,
  readPersistedEnvironmentStore,
  writeEnvironmentStore
} from './runtime-environment-store-file'
import { RuntimeEnvironmentStoreError } from './runtime-environment-store-records'
import {
  readCurrentRuntimeEnvironmentSidecarEntry,
  writeRuntimeEnvironmentSidecarEntry
} from './runtime-environment-sidecar'
import { resolveEnvironmentFromStore } from './runtime-environment-store'
import { findCollidingEnvironmentName } from '../host-catalog/runtime-environment-name-collision'

/** Registers a server Topo deployed over SSH, paired through its own loopback tunnel. */
export function addManagedTopodEnvironment(
  userDataPath: string,
  args: {
    id: string
    name: string
    pairingCode: string
    topodDeployment: TopodSshDeploymentLink
    now?: number
  }
): KnownRuntimeEnvironment {
  const offer = parsePairingCode(args.pairingCode)
  if (!offer) {
    throw new RuntimeEnvironmentStoreError('invalid_argument', 'Invalid managed pairing code.')
  }
  const known = readEnvironmentStore(userDataPath, { recoverBlankStore: true }).environments
  if (known.some((entry) => entry.id === args.id)) {
    throw new RuntimeEnvironmentStoreError(
      'invalid_argument',
      `A server with id "${args.id}" already exists.`
    )
  }
  const namesake = findCollidingEnvironmentName(known, args.name)
  if (namesake) {
    throw new RuntimeEnvironmentStoreError(
      'invalid_argument',
      `A server named "${namesake.name}" already exists.`
    )
  }
  const environment = createEnvironmentFromPairingOffer({
    id: args.id,
    name: args.name,
    now: args.now ?? Date.now(),
    offer,
    runtimeId: null,
    connectionDependency: 'ssh-tunnel'
  })
  if (getPreferredLoopbackRuntimePort(environment) !== args.topodDeployment.localPort) {
    throw new RuntimeEnvironmentStoreError(
      'invalid_argument',
      'The managed pairing does not point at its SSH tunnel.'
    )
  }
  const persisted = PersistedRuntimeEnvironmentSchema.parse(environment)
  const environments = [
    ...readPersistedEnvironmentStore(userDataPath, { recoverBlankStore: true }).environments,
    persisted
  ].sort((a, b) => a.name.localeCompare(b.name))
  // Sidecar first: a crash between the writes leaves an ownerless entry the next write prunes,
  // never a registered server that has lost its deployment link.
  writeRuntimeEnvironmentSidecarEntry(userDataPath, environments, persisted, {
    topodDeployment: args.topodDeployment
  })
  writeEnvironmentStore(userDataPath, { version: 1, environments })
  const registered = readEnvironmentStore(userDataPath).environments.find(
    (entry) => entry.id === args.id
  )
  if (!registered?.topodDeployment) {
    throw new RuntimeEnvironmentStoreError(
      'runtime_error',
      'This host’s Topo server was saved without its deployment link.'
    )
  }
  return registered
}

/** Remove the persisted server and deployment sidecar only once topod is proven exited. */
export function removeManagedTopodEnvironment(userDataPath: string, environmentId: string): void {
  const store = readPersistedEnvironmentStore(userDataPath)
  const persisted = resolveEnvironmentFromStore(store, environmentId)
  // Throws before the store write when the entry is unreadable, so its link is never orphaned.
  readCurrentRuntimeEnvironmentSidecarEntry(userDataPath, persisted)
  const remaining = store.environments.filter((entry) => entry.id !== persisted.id)
  writeEnvironmentStore(userDataPath, { version: 1, environments: remaining })
  writeRuntimeEnvironmentSidecarEntry(userDataPath, remaining, persisted, null)
}

/** Keeps a managed server's pairing current after its topod changed versions. */
export function refreshManagedTopodPairing(
  userDataPath: string,
  environmentId: string,
  pairingCode: string,
  now = Date.now()
): KnownRuntimeEnvironment {
  const offer = parsePairingCode(pairingCode)
  if (!offer) {
    throw new RuntimeEnvironmentStoreError('invalid_argument', 'Invalid managed pairing code.')
  }
  return rebindManagedTopodPairing(userDataPath, environmentId, () => offer, null, now)
}

/** Moves a managed server's tunnel to a new local port, keeping its pairing and identity. */
export function moveManagedTopodLocalPort(
  userDataPath: string,
  environmentId: string,
  localPort: number,
  now = Date.now()
): KnownRuntimeEnvironment {
  return rebindManagedTopodPairing(
    userDataPath,
    environmentId,
    (current) => {
      const offer = getPreferredPairingOffer(current)
      const endpoint = new URL(offer.endpoint)
      endpoint.port = String(localPort)
      return { ...offer, endpoint: endpoint.toString() }
    },
    localPort,
    now
  )
}

function rebindManagedTopodPairing(
  userDataPath: string,
  environmentId: string,
  nextOffer: (current: KnownRuntimeEnvironment) => PairingOffer,
  localPort: number | null,
  now: number
): KnownRuntimeEnvironment {
  const current = resolveEnvironmentFromStore(readEnvironmentStore(userDataPath), environmentId)
  if (!current.topodDeployment) {
    throw new RuntimeEnvironmentStoreError('invalid_argument', 'This server is not managed.')
  }
  const deployment = getTopodSshDeployment(current)
  if (!deployment) {
    throw new RuntimeEnvironmentStoreError(
      'invalid_argument',
      'This server is not managed over SSH.'
    )
  }
  const offer = nextOffer(current)
  const nextDeployment = { ...deployment, localPort: localPort ?? deployment.localPort }
  // Unchanged enrolled offers need no rewrite; each rewrite rebinds the sidecar.
  if (samePairing(getPreferredPairingOffer(current), offer)) {
    return current
  }
  const store = readPersistedEnvironmentStore(userDataPath)
  const existing = resolveEnvironmentFromStore(store, environmentId)
  const entry = readCurrentRuntimeEnvironmentSidecarEntry(userDataPath, existing)
  const next = PersistedRuntimeEnvironmentSchema.parse({
    ...createEnvironmentFromPairingOffer({
      id: existing.id,
      name: existing.name,
      now: existing.createdAt,
      offer,
      runtimeId: existing.runtimeId,
      connectionDependency: 'ssh-tunnel'
    }),
    updatedAt: now,
    pairingRevision: Math.max(now, (existing.pairingRevision ?? existing.createdAt) + 1),
    lastUsedAt: existing.lastUsedAt
  })
  if (getPreferredLoopbackRuntimePort(next) !== nextDeployment.localPort) {
    throw new RuntimeEnvironmentStoreError(
      'invalid_argument',
      'The managed pairing does not point at its SSH tunnel.'
    )
  }
  const environments = store.environments.map((candidate) =>
    candidate.id === existing.id ? next : candidate
  )
  const { binding: _binding, ...rest } = entry ?? {}
  // Bind both store states around the write so interruptions preserve the deployment link; read moved ports from the stored endpoint between writes.
  writeRuntimeEnvironmentSidecarEntry(
    userDataPath,
    store.environments,
    existing,
    { ...rest, topodDeployment: deployment },
    next
  )
  writeEnvironmentStore(userDataPath, { version: 1, environments })
  writeRuntimeEnvironmentSidecarEntry(userDataPath, environments, next, {
    ...rest,
    topodDeployment: nextDeployment
  })
  return resolveEnvironmentFromStore(readEnvironmentStore(userDataPath), environmentId)
}

function samePairing(left: PairingOffer, right: PairingOffer): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.deviceToken === right.deviceToken &&
    left.publicKeyB64 === right.publicKeyB64 &&
    left.pairedDeviceId === right.pairedDeviceId
  )
}

/** Mark migration before attempting commit so a crash cannot leave rollback to a premigration snapshot enabled. */
export function recordManagedTopodMigration(
  userDataPath: string,
  environmentId: string,
  at: string
): KnownRuntimeEnvironment {
  const store = readPersistedEnvironmentStore(userDataPath)
  const persisted = resolveEnvironmentFromStore(store, environmentId)
  const entry = readCurrentRuntimeEnvironmentSidecarEntry(userDataPath, persisted)
  if (!entry?.topodDeployment) {
    throw new RuntimeEnvironmentStoreError('invalid_argument', 'This server is not managed.')
  }
  const { binding: _binding, ...state } = entry
  // Keep the latest migration mark, including delta moves, so older snapshots remain blocked.
  const latest =
    state.topodMigratedAt && Date.parse(state.topodMigratedAt) >= Date.parse(at)
      ? state.topodMigratedAt
      : at
  writeRuntimeEnvironmentSidecarEntry(userDataPath, store.environments, persisted, {
    ...state,
    topodMigratedAt: latest
  })
  return resolveEnvironmentFromStore(readEnvironmentStore(userDataPath), environmentId)
}
