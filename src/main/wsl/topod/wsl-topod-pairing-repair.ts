/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../../shared/remote-runtime/host-store/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { readActiveManagedTopodReadiness } from '../../managed-server/lifecycle/topod-managed-bound-port'
import {
  ManagedTopodPairingRepairs,
  type ManagedTopodPairingRepairDeps
} from '../../managed-server/lifecycle/topod-managed-pairing-repair'

import { TopodManagedPairingRepairFailedError } from '../../managed-server/lifecycle/topod-managed-pairing-repair-failure'
import { notifyManagedTopodPairingRepaired } from '../../managed-server/lifecycle/topod-managed-pairing-repaired-listener'
import type { WslTopodHostTarget } from './wsl-topod-host-target'
import { type WslTopodHostTransport, createWslTopodHostTransport } from './wsl-topod-host-transport'
import type { WslTopodPairingRecovery } from './wsl-topod-pairing-identity'

type WslTopodHostAccess = { target: WslTopodHostTarget; connection: WslTopodHostTransport }

export function liveWslTopodPairingRepairDeps(
  userDataPath: string
): ManagedTopodPairingRepairDeps<WslTopodHostAccess> {
  const record = (environmentId: string) => {
    const found = findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new TopodManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslTopodHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: record(environment.id).distro,
        label: environment.name
      }
      return { target, connection: createWslTopodHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedTopodReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: (environment) => {
      const found = findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: (environmentId, pairingCode) => {
      const { localPort, remotePort } = record(environmentId)
      return refreshWslHostPairing(userDataPath, environmentId, {
        pairingCode,
        localPort,
        remotePort
      }).environment
    },
    repaired: notifyManagedTopodPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslTopodPairingRecovery(
  userDataPath: string,
  deps: ManagedTopodPairingRepairDeps<WslTopodHostAccess> = liveWslTopodPairingRepairDeps(
    userDataPath
  )
): Omit<WslTopodPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedTopodPairingRepairs(deps), resolve: deps.resolve }
}
