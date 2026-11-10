export const TOPOD_PLAINTEXT_SECRETS_ENV = 'TOPO_HEADLESS_SECRET_STORE'

export function describeTopodPlaintextOptOut(): string {
  return (
    `${TOPOD_PLAINTEXT_SECRETS_ENV}=plaintext is set, so Topo's headless server stores ` +
    'credentials unencrypted on this host.'
  )
}

export function describeTopodDisposableProfile(): string {
  return (
    "Topo's headless server is running from a temporary profile, so it stores credentials " +
    'unencrypted and leaves the saved credential key and existing credentials untouched.'
  )
}

/** Machine IDs are public; adjacent keys do not protect against copying the whole account or backup. */
export function describeTopodHostKeyGap(hostBound: boolean): string {
  const binding = hostBound ? ', mixed with this machine ID' : ''
  return (
    "Topo's headless server seals credentials with a key kept beside them in its private " +
    `credential directory${binding}. Anyone who can read this account's files on this host, or a ` +
    'backup of them, can unseal them.'
  )
}

export function describeTopodSealingUnavailable(reason: string, stateFile: string): string {
  return (
    `Topo's headless server cannot unseal its credentials: ${reason}. Saved credentials are kept ` +
    `as they are and new ones are refused until this is fixed and the server restarts. To start ` +
    `over and reconnect every integration, delete ${stateFile}.`
  )
}
