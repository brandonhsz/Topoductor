import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  TOPOD_MOBILE_WEB_DIR,
  TOPOD_MOBILE_WEB_MANIFEST,
  topodMobileWebAssetFilenames
} from '../../../../src/shared/topod-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  '../../desktop-distribution/runtime-verification/verify-packaged-mobile-web-bundle.cjs'
)
const { assertNoDarkOutputOfOffSwitches } = createRequire(import.meta.url)(
  '../../../dark-build-switches.cjs'
)

// Require a fresh built page as beforePack does: an topod package without it cannot serve phones.
export function stageTopodMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  // The release template refuses the variable itself.
  assertNoDarkOutputOfOffSwitches([bundleDir])
  assertMobileWebBundleBuilt(bundleDir)
  // The guard refuses unlisted files, so the tree is the manifest, its assets and a dark marker.
  cpSync(bundleDir, join(outputDir, ...TOPOD_MOBILE_WEB_DIR.split('/')), { recursive: true })
}

export function readTopodMobileWebAssetFilenames(packageDir) {
  return topodMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...TOPOD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
