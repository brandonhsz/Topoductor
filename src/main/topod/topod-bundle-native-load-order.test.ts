import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { runProcessSync } from '@topo/process-host'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('loads a fresh production import graph before requiring native PTY code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'topod-load-order-'))
  directories.push(directory)
  const bundle = join(directory, 'topod.js')
  const builder = pathToFileURL(
    join(REPO_ROOT, 'config/scripts/topod-distribution/server-bundle/topod-entry-build.mjs')
  ).href
  const built = runProcessSync({
    program: process.execPath,
    args: [
      '--input-type=module',
      '-e',
      `import { buildTopodEntry } from ${JSON.stringify(builder)}; await buildTopodEntry(${JSON.stringify(bundle)})`
    ],
    cwd: REPO_ROOT,
    env: { ...process.env, TOPO_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr.slice(0, 2_000)).toBe(0)
  expect(existsSync(bundle)).toBe(true)

  const marker = join(directory, 'premature-native-load')
  const preload = join(directory, 'preload.cjs')
  writeFileSync(
    preload,
    [
      "const Module = require('node:module')",
      'const original = Module._load',
      'Module._load = function (request, ...rest) {',
      "  if (request === 'node-pty') {",
      `    require('node:fs').writeFileSync(${JSON.stringify(marker)}, request)`,
      "    throw new Error('native PTY required before preflight')",
      '  }',
      '  return original.call(this, request, ...rest)',
      '}'
    ].join('\n')
  )
  const run = (extraArgs: string[] = []) =>
    runProcessSync({
      program: process.execPath,
      args: ['--require', preload, ...extraArgs, bundle, '--topod-smoke-load-check'],
      env: { ...process.env, TOPO_BACKGROUND_LAUNCH: '1' },
      timeoutMs: 30_000
    })

  const loaded = run()
  expect(loaded.code, loaded.stderr.slice(0, 2_000)).toBe(0)
  expect(existsSync(marker)).toBe(false)

  const eagerNative = join(directory, 'eager-native.cjs')
  writeFileSync(eagerNative, "require('node-pty')")
  expect(run(['--require', eagerNative]).code).not.toBe(0)
  expect(existsSync(marker)).toBe(true)
}, 90_000)
