import { describe, expect, it } from 'vitest'
import {
  classifyWslTopodLiveness,
  nextWslLivenessProbe,
  type WslLivenessEvidence
} from './wsl-topod-liveness-verdict'

const INSTANCE = 'boot-a:100'
const TOPOD = '321:5000'

function evidence(overrides: Partial<WslLivenessEvidence> = {}): WslLivenessEvidence {
  return {
    trigger: { source: 'bridge', code: 1 },
    running: { status: 'confirmed', running: true },
    expected: { distroInstance: INSTANCE, topod: TOPOD },
    ...overrides
  }
}

describe('classifyWslTopodLiveness', () => {
  it('reads a failed running-list probe as unverifiable, never exited, whatever the exit code', () => {
    for (const code of [0, 1, null]) {
      const verdict = classifyWslTopodLiveness(
        evidence({ trigger: { source: 'bridge', code }, running: { status: 'unavailable' } })
      )
      expect(verdict).toEqual({ kind: 'unverifiable', reason: 'running-list-unavailable' })
    }
  })

  it('marks every terminal exited when the distro is confirmed stopped', () => {
    const verdict = classifyWslTopodLiveness(
      evidence({ running: { status: 'confirmed', running: false } })
    )
    expect(verdict).toEqual({ kind: 'distro-stopped', corroborated: true })
  })

  it('needs no exit code to prove a stop, but only a failed exit corroborates it', () => {
    const stopped = { status: 'confirmed', running: false } as const
    expect(
      classifyWslTopodLiveness(evidence({ trigger: { source: 'verify' }, running: stopped }))
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
    expect(
      classifyWslTopodLiveness(
        evidence({ trigger: { source: 'holder', code: 0 }, running: stopped })
      )
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
  })

  it('treats a running distro whose guest did not answer as unverifiable', () => {
    expect(classifyWslTopodLiveness(evidence({ identity: null }))).toEqual({
      kind: 'unverifiable',
      reason: 'guest-unanswered'
    })
  })

  it('proves a restart from a new boot id or pid 1 start time, without any wall clock', () => {
    const verdict = classifyWslTopodLiveness(
      evidence({ identity: { distroInstance: 'boot-a:900', topod: null } })
    )
    expect(verdict).toEqual({ kind: 'distro-restarted' })
  })

  it('reads a gone or reused topod pid in the same incarnation as topod exited', () => {
    for (const topod of [null, '321:7777']) {
      const verdict = classifyWslTopodLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, topod }
        })
      )
      expect(verdict).toEqual({ kind: 'topod-exited' })
    }
  })

  it('keeps topod live when the same process still runs, even after a bridge exit', () => {
    expect(
      classifyWslTopodLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, topod: TOPOD }
        })
      )
    ).toEqual({ kind: 'live' })
  })

  it('falls back to the port when no topod pid was known', () => {
    const base = evidence({
      expected: { distroInstance: INSTANCE, topod: null },
      identity: { distroInstance: INSTANCE, topod: null }
    })
    expect(classifyWslTopodLiveness({ ...base, topodPort: 'ready' })).toEqual({ kind: 'live' })
    expect(classifyWslTopodLiveness({ ...base, topodPort: 'refused' })).toEqual({
      kind: 'topod-exited'
    })
    expect(classifyWslTopodLiveness({ ...base, topodPort: 'unverifiable' })).toEqual({
      kind: 'unverifiable',
      reason: 'topod-unanswered'
    })
  })
})

describe('nextWslLivenessProbe', () => {
  it('never probes inside a distro that is not confirmed running (an exec would boot it)', () => {
    expect(nextWslLivenessProbe(evidence({ running: { status: 'unavailable' } }))).toBeNull()
    expect(
      nextWslLivenessProbe(evidence({ running: { status: 'confirmed', running: false } }))
    ).toBeNull()
  })

  it('asks for identity first, and for the port only when no pid identity can decide', () => {
    expect(nextWslLivenessProbe(evidence())).toBe('identity')
    expect(
      nextWslLivenessProbe(evidence({ identity: { distroInstance: INSTANCE, topod: TOPOD } }))
    ).toBeNull()
    const noPid = evidence({
      expected: { distroInstance: INSTANCE, topod: null },
      identity: { distroInstance: INSTANCE, topod: null }
    })
    expect(nextWslLivenessProbe(noPid)).toBe('topod-port')
    expect(nextWslLivenessProbe({ ...noPid, topodPort: 'refused' })).toBeNull()
    expect(
      nextWslLivenessProbe({ ...noPid, identity: { distroInstance: 'other', topod: null } })
    ).toBeNull()
  })
})
