import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const artifacts = vi.hoisted(() => ({ files: ['topod-server.js', 'daemon-entry.js'] }))
vi.mock('./topod-artifact-identity', () => ({
  listTopodArtifactFilenames: async () => artifacts.files
}))

import {
  consumeTopodStartupQualification,
  topodStartupQualificationKey,
  recordTopodStartupQualification
} from './topod-startup-qualification'

let slot: string

beforeEach(() => {
  slot = mkdtempSync(join(tmpdir(), 'topod-qualified-'))
  for (const name of artifacts.files) {
    writeFileSync(join(slot, name), `${name} bytes`)
  }
})

afterEach(() => {
  rmSync(slot, { recursive: true, force: true })
})

describe('topod startup qualification', () => {
  it('keys on the artifact version and on every installed file staying the same file', async () => {
    const key = await topodStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')

    expect(await topodStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')).toBe(key)
    expect(await topodStartupQualificationKey(slot, '0.2.0+aaaaaaaaaaaa')).not.toBe(key)
    rmSync(join(slot, 'daemon-entry.js'))
    writeFileSync(join(slot, 'daemon-entry.js'), 'replaced')
    expect(await topodStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')).not.toBe(key)
  })

  it('consumes a matching marker once, so a launch that dies before readiness re-qualifies', async () => {
    await recordTopodStartupQualification(slot, 'key-1')

    expect(await consumeTopodStartupQualification(slot, 'key-1')).toBe(true)
    expect(await consumeTopodStartupQualification(slot, 'key-1')).toBe(false)
  })
})
