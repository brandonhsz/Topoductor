import type { PairingOffer } from '../pairing/mobile-relay-pairing-offer'
import { getTopodSshDeployment, type KnownRuntimeEnvironment } from './runtime-environments'

/** Match persisted host-key identity: different saved names/endpoints can still describe one server. */
export function findEnvironmentWithHostKey<T extends Pick<KnownRuntimeEnvironment, 'endpoints'>>(
  environments: readonly T[],
  publicKeyB64: string
): T | undefined {
  const key = canonicalHostKeyB64(publicKeyB64)
  return environments.find((environment) =>
    environment.endpoints.some((endpoint) => canonicalHostKeyB64(endpoint.publicKeyB64) === key)
  )
}

export function sameHostKeyB64(a: string, b: string): boolean {
  return canonicalHostKeyB64(a) === canonicalHostKeyB64(b)
}

/** Why: pairing links accept unpadded and URL-safe Base64, which decode to the same key. */
function canonicalHostKeyB64(publicKeyB64: string): string {
  return publicKeyB64.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
}

/** Retain saved key spelling: the fingerprint hashes its text, so respelling would retire the server’s workspaces. */
export function savedHostKeySpelling(
  environment: Pick<KnownRuntimeEnvironment, 'endpoints'>,
  offer: Pick<PairingOffer, 'publicKeyB64'>
): string {
  const key = canonicalHostKeyB64(offer.publicKeyB64)
  return (
    environment.endpoints.find((endpoint) => canonicalHostKeyB64(endpoint.publicKeyB64) === key)
      ?.publicKeyB64 ?? offer.publicKeyB64
  )
}

/** Another saved entry that manages the same server over SSH: one machine saved under a second alias. */
export function findManagedSshTwin<
  T extends Pick<KnownRuntimeEnvironment, 'id' | 'endpoints' | 'topodDeployment'>
>(environments: readonly T[], environment: T): T | undefined {
  if (!getTopodSshDeployment(environment)) {
    return undefined
  }
  const others = environments.filter(
    (other) => other.id !== environment.id && getTopodSshDeployment(other) !== undefined
  )
  for (const endpoint of environment.endpoints) {
    const twin = findEnvironmentWithHostKey(others, endpoint.publicKeyB64)
    if (twin) {
      return twin
    }
  }
  return undefined
}
