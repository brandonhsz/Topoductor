/** D2c: only a confirmed stopped distro or changed boot/PID1 incarnation proves all old terminals exited. Failed/unreadable probes remain unverifiable, as with SSH silence. Bridge/holder exit codes trigger checks but never prove death: WSL exit 1 also means service hiccups and bridge exit 0 means socket close. */

export type WslLivenessTrigger =
  /** The held watch bridge or the holder `wsl.exe` exited with this code. */
  | { source: 'bridge' | 'holder'; code: number | null }
  /** A heartbeat, a power resume, or a retry: nothing exited, so re-check everything. */
  | { source: 'verify' }

export type WslLivenessEvidence = {
  trigger: WslLivenessTrigger
  /** A fresh `wsl --list --running` read; never a cached or fail-closed list. */
  running: { status: 'confirmed'; running: boolean } | { status: 'unavailable' }
  /** Absent unless the distro was confirmed running; null when the guest could not answer. */
  identity?: { distroInstance: string; topod: string | null } | null
  /** What the connection recorded when it last reached ready. */
  expected: { distroInstance: string | null; topod: string | null }
  /** A fresh bridge to topod's port, opened only when process identity cannot decide. */
  topodPort?: 'ready' | 'refused' | 'unverifiable'
}

export type WslLivenessVerdict =
  /** Confirmed stopped: every terminal and process in it is `exited`. */
  | { kind: 'distro-stopped'; corroborated: boolean }
  /** Running, but a new incarnation: every process of the old one is `exited`. */
  | { kind: 'distro-restarted' }
  /** Distro running, topod gone: relaunch, then let the census decide about terminals. */
  | { kind: 'topod-exited' }
  | { kind: 'live' }
  | { kind: 'unverifiable'; reason: WslLivenessUnverifiableReason }

export type WslLivenessUnverifiableReason =
  | 'running-list-unavailable'
  | 'guest-unanswered'
  | 'topod-unanswered'

/** What the classifier still needs before it can decide; the supervisor gathers it in order. */
export type WslLivenessNextProbe = 'identity' | 'topod-port' | null

export function nextWslLivenessProbe(evidence: WslLivenessEvidence): WslLivenessNextProbe {
  if (evidence.running.status !== 'confirmed' || !evidence.running.running) {
    return null
  }
  if (evidence.identity === undefined) {
    return 'identity'
  }
  const { identity, expected } = evidence
  if (identity === null) {
    return null
  }
  if (expected.distroInstance !== null && identity.distroInstance !== expected.distroInstance) {
    return null
  }
  if (expected.topod !== null) {
    return null
  }
  return evidence.topodPort === undefined ? 'topod-port' : null
}

export function classifyWslTopodLiveness(evidence: WslLivenessEvidence): WslLivenessVerdict {
  const { running, trigger, expected } = evidence
  if (running.status !== 'confirmed') {
    return { kind: 'unverifiable', reason: 'running-list-unavailable' }
  }
  if (!running.running) {
    return {
      kind: 'distro-stopped',
      corroborated: trigger.source !== 'verify' && trigger.code !== null && trigger.code !== 0
    }
  }
  const identity = evidence.identity
  if (!identity) {
    return { kind: 'unverifiable', reason: 'guest-unanswered' }
  }
  if (expected.distroInstance !== null && identity.distroInstance !== expected.distroInstance) {
    return { kind: 'distro-restarted' }
  }
  if (expected.topod !== null) {
    // Same pid and same start ticks in the same incarnation is the same process.
    return identity.topod === expected.topod ? { kind: 'live' } : { kind: 'topod-exited' }
  }
  // No process identity to compare (no pid file): topod's own port has to answer.
  if (evidence.topodPort === 'ready') {
    return { kind: 'live' }
  }
  if (evidence.topodPort === 'refused') {
    return { kind: 'topod-exited' }
  }
  return { kind: 'unverifiable', reason: 'topod-unanswered' }
}
