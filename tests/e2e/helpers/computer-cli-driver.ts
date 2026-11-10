import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'topo-runtime.json'
let topoDevUserDataPath: string | null = null
let topoServeProcess: ChildProcess | null = null
let topoServeStdout = ''
let topoServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunTopoCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runTopoCli(
  args: string[],
  options: RunTopoCliOptions = {}
): Promise<CliResult> {
  try {
    return await runTopoCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Windows can lose the dev runtime while launching the fixture app; reopen once before the desktop action.
      await ensureTopoRuntimeLaunched()
      return await runTopoCliOnce(args)
    }
    throw error
  }
}

async function runTopoCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/development/launch/topo-dev.mjs')
  const command = process.env.TOPO_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.TOPO_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.TOPO_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureTopoRuntimeLaunched(): Promise<void> {
  if (!process.env.TOPO_COMPUTER_CLI && process.platform === 'win32') {
    await ensureTopoRuntimeServed()
    return
  }
  await runTopoCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForTopoRuntimeReady()
}

export async function stopTopoRuntime(): Promise<void> {
  const processToStop = topoServeProcess
  if (!processToStop?.pid) {
    return
  }
  topoServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eTopoDevUserDataPath(): Promise<string> {
  if (!topoDevUserDataPath) {
    // Use a fresh profile so a retained dev runtime cannot execute stale provider code.
    topoDevUserDataPath = await mkdtemp(join(tmpdir(), 'topo-computer-runtime-'))
  }
  return topoDevUserDataPath
}

async function waitForTopoRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eTopoDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runTopoCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    topoServeStdout.trim() ? `serve stdout: ${topoServeStdout.trim()}` : null,
    topoServeStderr.trim() ? `serve stderr: ${topoServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Topo runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureTopoRuntimeServed(): Promise<void> {
  if (!topoServeProcess || topoServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/development/launch/topo-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    topoServeStdout = ''
    topoServeStderr = ''
    topoServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    topoServeProcess.stdout?.on('data', (chunk) => {
      topoServeStdout += String(chunk)
    })
    topoServeProcess.stderr?.on('data', (chunk) => {
      topoServeStderr += String(chunk)
    })
    topoServeProcess.once('exit', () => {
      topoServeProcess = null
    })
    process.once('exit', () => {
      topoServeProcess?.kill()
    })
  }
  await waitForTopoRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.TOPO_DEV_USER_DATA_PATH ?? (await getComputerE2eTopoDevUserDataPath())
  // Strip ELECTRON_RUN_AS_NODE or the Electron child runs as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Keep CLI and Electron on the same runtime metadata while fixture HOME/Codex isolation remains in force.
    TOPO_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Topo runtime metadata')
  )
}
