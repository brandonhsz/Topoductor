/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { TOPOD_MANAGED_REMOTE_PORT } from '../../../shared/topod-managed-runtime'
import {
  type TopodTerminalCensus,
  UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
} from '../../../shared/topod-terminal-census'
import type { ServeReadiness } from '../../server/serve-readiness'
import { probeActiveTopodReadiness } from '../../managed-server/activation/topod-active-readiness'
import { topodBoundPort } from '../../managed-server/lifecycle/topod-managed-bound-port'
import { managedTopodInstallDir } from '../../managed-server/lifecycle/topod-managed-runtime-context'
import { wakeStoppedManagedTopod } from '../../managed-server/lifecycle/topod-managed-wake'
import type { TopodRemoteContext } from '../../managed-server/install/topod-remote-context'
import type { TopodSlotOptions } from '../../managed-server/activation/topod-recovery-slot'
import { readRemoteTopodBuildHash } from '../../managed-server/install/topod-remote-build-hash'
import {
  requestTopodTerminalCensus,
  type TopodTerminalCensusRequestOptions
} from '../../managed-server/lifecycle/topod-terminal-census-client'
import { updateTerminalCounts } from '../../managed-server/activation/topod-fenced-stop'
import { tunneledTopodPairingCode } from '../../managed-server/lifecycle/topod-tunneled-pairing'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { TopodHostTransport } from '../../managed-server/install/topod-host-transport'
import type { WslTopodHostTarget } from './wsl-topod-host-target'
import { listenWslTopodStdioBridge } from './wsl-topod-stdio-bridge'

export type WslTopodIncumbent = {
  census: TopodTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<TopodTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: TopodRemoteContext<WslTopodHostTarget>
  slot: TopodSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslTopodIncumbent = {
  census: UNVERIFIABLE_TOPOD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_TOPOD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslTopodIncumbentDependencies = {
  wake: typeof wakeStoppedManagedTopod
  probe: typeof probeActiveTopodReadiness
  readBuildHash: typeof readRemoteTopodBuildHash
  listen: (
    transport: TopodHostTransport,
    remotePort: number,
    target: WslTopodHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestTopodTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslTopodIncumbentDependencies = {
  wake: wakeStoppedManagedTopod,
  probe: probeActiveTopodReadiness,
  readBuildHash: readRemoteTopodBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslTopodStdioBridge(transport, {
      environmentId: target.id,
      distro: target.distro,
      remotePort,
      localPort: 0,
      label: `Topo server in WSL: ${target.label} (update check)`
    }),
  census: requestTopodTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslTopodIncumbent(
  args: IncumbentArgs,
  dependencies: WslTopodIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslTopodIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedTopodInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslTopodIncumbentDependencies,
  options: TopodTerminalCensusRequestOptions
): Promise<TopodTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      topodBoundPort(readiness) ?? TOPOD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledTopodPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_TOPOD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
