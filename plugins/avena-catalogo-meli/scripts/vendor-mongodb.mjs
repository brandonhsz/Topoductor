// Rebuilds vendor/mongodb.mjs: plugins ship no node_modules, so the worker loads one bundled file.
// Usage: node scripts/vendor-mongodb.mjs <dir with mongodb installed> (npm i mongodb@6 there first)
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const source = process.argv[2]
if (!source) {
  throw new Error('Pass the folder where mongodb@6 is installed')
}
const entry = join(source, 'mongodb-entry.mjs')
writeFileSync(entry, "export { MongoClient } from 'mongodb'\n")

await build({
  entryPoints: [entry],
  absWorkingDir: source,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'eof',
  // Optional drivers the client loads only when a connection asks for them.
  external: [
    'kerberos',
    'snappy',
    '@mongodb-js/zstd',
    '@aws-sdk/credential-providers',
    'gcp-metadata',
    'socks',
    'mongodb-client-encryption'
  ],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
  },
  outfile: new URL('../vendor/mongodb.mjs', import.meta.url).pathname
})
