import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOPOD_VERSION, topodArtifactFilenames } from '../../../../src/shared/topod-artifacts.ts'
import { readTopodMobileWebAssetFilenames } from './topod-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeTopodFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of topodArtifactFilenames(
    target,
    readTopodMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `topod declares ${filename} in TOPOD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/topod-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${TOPOD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
