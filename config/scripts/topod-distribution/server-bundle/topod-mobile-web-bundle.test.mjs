import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TOPOD_MOBILE_WEB_MANIFEST } from '../../../../src/shared/topod-artifacts.ts'
import { writeMobileWebBundleFixtureTree } from '../../build/mobile-web-app/mobile-web-bundle-fixture-tree.mjs'
import {
  readTopodMobileWebAssetFilenames,
  stageTopodMobileWebBundle
} from './topod-mobile-web-bundle.mjs'

let scratch
let bundleDir
let outputDir

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'topod-mobile-web-'))
  bundleDir = join(scratch, 'mobile-web')
  outputDir = join(scratch, 'topod')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(scratch, { recursive: true, force: true })
})

it('stages the manifest and every asset it lists, byte for byte', async () => {
  const { manifest } = await writeMobileWebBundleFixtureTree({ outDir: bundleDir })
  stageTopodMobileWebBundle(outputDir, bundleDir)

  const staged = readTopodMobileWebAssetFilenames(outputDir)
  expect(staged).toHaveLength(manifest.assets.length)
  for (const asset of manifest.assets) {
    expect(readFileSync(join(outputDir, 'out', 'mobile-web', asset.path))).toEqual(
      readFileSync(join(bundleDir, asset.path))
    )
  }
  expect(readFileSync(join(outputDir, TOPOD_MOBILE_WEB_MANIFEST))).toEqual(
    readFileSync(join(bundleDir, 'manifest.json'))
  )
})
