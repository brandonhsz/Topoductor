// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { TOPOD_MANAGED_REMOTE_PORT } from '../../../shared/topod-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/hosts/identity/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { topodBoundPort } from './topod-managed-bound-port'
import { tunneledTopodPairingCode } from './topod-tunneled-pairing'
import { TopodManagedPairingRepairFailedError } from './topod-managed-pairing-repair-failure'
import { quotePosixShellUnlessPlain } from '../../../shared/shell/launch/shell-argument-quoting'
import { RUNTIME_SERVER_REPLACED_STATUS_CODE } from '../../../shared/remote-runtime/host-status/runtime-host-status'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type TopodTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const TOPOD_IDENTITY_MISMATCH_CODE = 'topod_identity_mismatch'

/** `foreign-port`: another process answered; `replaced-server`: the host's own slot serves another key. */
export type TopodIdentityMismatchKind = 'foreign-port' | 'replaced-server'

export class TopodManagedIdentityError extends Error {
  readonly code = TOPOD_IDENTITY_MISMATCH_CODE
  private constructor(
    readonly kind: TopodIdentityMismatchKind,
    explanation: string,
    detail: string
  ) {
    super(`${TOPOD_IDENTITY_MISMATCH_CODE}: ${explanation}: ${detail}`)
    this.name = 'TopodManagedIdentityError'
  }

  static foreignPort(remotePort: number, detail: string): TopodManagedIdentityError {
    return new TopodManagedIdentityError(
      'foreign-port',
      `the server on remote port ${remotePort} is not this host’s Topo server ` +
        '(another Topo may be using that port)',
      detail
    )
  }

  /** SSH access alone can't re-pin a different server key, so only the user can re-pair. */
  static replacedServer(
    environment: { id: string; name: string },
    detail: string
  ): TopodManagedIdentityError {
    const environmentName = environment.name
    // Why the id: a name is free text, so pasting it into a shell could expand or pick another server.
    const selector = quotePosixShellUnlessPlain(environment.id)
    return new TopodManagedIdentityError(
      'replaced-server',
      `${environmentName} is not the Topo server this desktop paired with (Topo now connects ` +
        'to the host as a different SSH user, or the server was reinstalled), so reconnecting ' +
        `won’t restore access. To pair with the host’s current server, open the ⋯ menu on ` +
        `${environmentName} in Settings › Remote Topo Servers and choose Forget… (or run ` +
        `\`topo environment forget --environment ${selector} --yes\`), then click ` +
        'Connect on the SSH host',
      detail
    )
  }
}

/** Status code of a refusal automatic retries can't clear (the pairing must change); null otherwise. */
export function managedTopodRefusalNeedingUserCode(error: unknown): string | null {
  if (error instanceof TopodManagedIdentityError && error.kind === 'replaced-server') {
    return RUNTIME_SERVER_REPLACED_STATUS_CODE
  }
  return error instanceof TopodManagedPairingRepairFailedError ? 'unauthorized' : null
}

export const TOPOD_PAIRING_REJECTED_CODE = 'topod_pairing_rejected'

export class TopodManagedPairingRejectedError extends Error {
  readonly code = TOPOD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${TOPOD_PAIRING_REJECTED_CODE}: this host’s Topo server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'TopodManagedPairingRejectedError'
  }
}

export function topodIdentityRefusal(
  remotePort: number,
  identity: Exclude<TopodTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new TopodManagedPairingRejectedError(identity.detail)
    : TopodManagedIdentityError.foreignPort(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyTopodTunnelIdentityFailure(error: unknown): TopodTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyTopodPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<TopodTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyTopodTunnelIdentityFailure(error)
  }
}

export function verifyManagedTopodTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<TopodTunnelIdentity> {
  if (!environment.topodDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyTopodPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedTopodTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: topodBoundPort(initial) ?? TOPOD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return topodBoundPort(readiness) ?? TOPOD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<TopodTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledTopodPairingCode(readiness, localPort))
      return pairing
        ? verifyTopodPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s Topo server published an invalid pairing.' }
    }
  }
}
