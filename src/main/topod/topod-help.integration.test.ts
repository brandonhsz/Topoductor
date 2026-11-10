import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '@topo/process-host'
import { TOPOD_LAUNCHER_FILENAME, TOPOD_SERVER_ENTRY_FILENAME } from '../../shared/topod-artifacts'

let directory = ''
let launcher = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'topod-help-'))
  launcher = join(directory, TOPOD_LAUNCHER_FILENAME)
  const builder = pathToFileURL(
    join(process.cwd(), 'config/scripts/topod-distribution/server-bundle/topod-entry-build.mjs')
  ).href
  const built = await runProcess({
    program: process.execPath,
    args: [
      '--input-type=module',
      '-e',
      `import {buildTopodEntry,buildTopodLauncher} from ${JSON.stringify(builder)};` +
        `await buildTopodEntry(${JSON.stringify(join(directory, TOPOD_SERVER_ENTRY_FILENAME))});` +
        `await buildTopodLauncher(${JSON.stringify(launcher)});`
    ],
    env: { ...process.env, TOPO_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr).toBe(0)
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('real topod executable help', () => {
  it('leaves an existing instance lock untouched', async () => {
    const dataRoot = join(directory, 'locked-profile')
    await mkdir(dataRoot)
    const lock = join(dataRoot, 'topod.lock')
    const content = 'an existing instance owns this profile\n'
    await writeFile(lock, content)
    const result = await runProcess({
      program: process.execPath,
      args: [launcher, '--help'],
      env: { ...process.env, TOPO_BACKGROUND_LAUNCH: '1', TOPO_USER_DATA: dataRoot },
      timeoutMs: 10_000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(await readFile(lock, 'utf8')).toBe(content)
    expect(await readdir(dataRoot)).toEqual(['topod.lock'])
  })
})
