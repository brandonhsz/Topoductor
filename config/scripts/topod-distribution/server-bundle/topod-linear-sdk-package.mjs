import { build } from 'esbuild'
import { join } from 'node:path'
import { TOPOD_LINEAR_SDK_ENTRY } from '../../../../src/shared/topod-artifacts.ts'
import { TOPOD_SERVER_BUILD_TARGET } from './topod-entry-build.mjs'

// Bundle @linear/sdk into one CJS file for lazy require: copying would expose chunk names that change each release.
export async function stageTopodLinearSdk(root, outputDir) {
  await build({
    stdin: {
      contents: "module.exports = require('@linear/sdk')",
      resolveDir: root,
      sourcefile: 'topod-linear-sdk-entry.js'
    },
    bundle: true,
    platform: 'node',
    target: TOPOD_SERVER_BUILD_TARGET,
    format: 'cjs',
    outfile: join(outputDir, TOPOD_LINEAR_SDK_ENTRY),
    minify: true,
    sourcemap: false,
    logLevel: 'error'
  })
}
