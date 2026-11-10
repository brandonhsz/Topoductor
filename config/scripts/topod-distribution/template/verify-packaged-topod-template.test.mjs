import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  TOPOD_NODE_RUNTIME_MARKER_FILENAME,
  TOPOD_TEMPLATE_MANIFEST_FILENAME,
  TOPOD_TEMPLATE_TARGETS_DIR
} from '../../../../src/shared/topod-artifacts.ts'
import { writeTopodTemplateTestFixture } from './topod-template-test-fixture.mjs'

const require = createRequire(import.meta.url)
const { verifyPackagedTopodTemplate } = require('./verify-packaged-topod-template.cjs')
const roots = []

async function createFixture(options) {
  const root = await mkdtemp(join(tmpdir(), 'topo-packaged-topod-template-'))
  roots.push(root)
  const templateDir = await writeTopodTemplateTestFixture(root, options)
  return { root, templateDir }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('verifyPackagedTopodTemplate', () => {
  it('rejects a page asset changed after manifest generation', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.templateDir, 'out/mobile-web/index.html'), 'mutated')

    expect(() => verifyPackagedTopodTemplate(fixture.root)).toThrow(
      'out/mobile-web/index.html checksum mismatch'
    )
  })

  it('rejects a target whose runtime reference names another Node', async () => {
    const fixture = await createFixture()
    const markerPath = join(
      fixture.templateDir,
      TOPOD_TEMPLATE_TARGETS_DIR,
      'darwin-arm64',
      TOPOD_NODE_RUNTIME_MARKER_FILENAME
    )
    await writeFile(markerPath, `${'0'.repeat(64)}\n`)
    const manifestPath = join(fixture.templateDir, TOPOD_TEMPLATE_MANIFEST_FILENAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.targets['darwin-arm64'].files[TOPOD_NODE_RUNTIME_MARKER_FILENAME] = createHash(
      'sha256'
    )
      .update(`${'0'.repeat(64)}\n`)
      .digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest))

    expect(() => verifyPackagedTopodTemplate(fixture.root)).toThrow(
      'darwin-arm64 runtime reference disagrees'
    )
  })

  // Desktop must carry deployment template on every OS: SSH/managed deploys materialize target slot from resourcesPath (D2).
})
