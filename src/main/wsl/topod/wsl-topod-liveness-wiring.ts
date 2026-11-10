/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import {
  probeThenWatchWslTopodBridges,
  type WslTopodBridgeActivity
} from './wsl-topod-bridge-activity'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  type TopodTerminalCensus,
  UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
} from '../../../shared/topod-terminal-census'
import { requestTopodTerminalCensus } from '../../managed-server/lifecycle/topod-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../../power/system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readSettledConfirmedRunningWslDistros
} from '../discovery/wsl-background-distro-gate'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import { readWslGuestIdentity } from '../execution/wsl-guest-process-identity'
import type { WslTopodConnection } from './wsl-topod-connection-types'
import type { WslTopodConnectionManager } from './wsl-topod-connection'
import { defaultWslTopodEnvironmentId } from './wsl-topod-deploy'
import { EXIT_SETTLE_MS } from './wsl-topod-liveness-evidence'
import { requireConfirmedRunning } from './wsl-topod-connection-errors'
import { WslTopodLivenessSupervisor } from './wsl-topod-liveness-supervisor'
import { createWslTopodHostTransport } from './wsl-topod-host-transport'
import { openWslTopodWatch } from './wsl-topod-watch'

function transportFor(distro: string, environmentId = defaultWslTopodEnvironmentId(distro)) {
  return createWslTopodHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslTopodCensus(connection: WslTopodConnection): Promise<TopodTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestTopodTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_TOPOD_TERMINAL_CENSUS)
}

export function createWslTopodLivenessSupervisor(options: {
  manager: WslTopodConnectionManager
  bridgeActivity: WslTopodBridgeActivity
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean
}): WslTopodLivenessSupervisor {
  return new WslTopodLivenessSupervisor({
    manager: options.manager,
    readRunning: ({ distro, exitedAt, probedAfter }) => {
      const settled =
        exitedAt === null || exitedAt === undefined ? undefined : exitedAt + EXIT_SETTLE_MS
      return readSettledConfirmedRunningWslDistros(
        distro,
        probedAfter === undefined ? settled : Math.max(settled ?? -Infinity, probedAfter)
      )
    },
    readIdentity: (distro, topodPid) => readWslGuestIdentity(transportFor(distro), topodPid),
    openWatch: (connection) =>
      probeThenWatchWslTopodBridges(
        () =>
          openWslTopodWatch(
            transportFor(connection.distro, connection.environmentId),
            connection.remotePort
          ),
        options.bridgeActivity,
        connection.environmentId
      ),
    collectCensus: collectWslTopodCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    deferUntilRunning: deferUntilWslDistroRunning,
    requireRunning: async (distro) =>
      requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro),
    // Liveness is background work: the holder may re-spawn only into a distro that runs (E9).
    ensureHolder: (distro) =>
      options.holder.ensureHeld(distro, {
        requireRunning: async () =>
          requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro)
      }),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
