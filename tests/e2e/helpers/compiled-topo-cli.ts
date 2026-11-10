// Run the bundled CLI as a separate process discovering this E2E runtime through its user-data directory.
import path from 'node:path'
import { runProcess } from '@topo/process-host'

export type TopoCliResult = {
  args: string[]
  code: number | null
  stdout: string
  stderr: string
  /** The parsed `--json` envelope, or null when stdout was not JSON. */
  json: {
    ok?: boolean
    result?: unknown
    error?: { code?: string; message?: string }
  } | null
}

export async function runCompiledTopoCli(
  userDataDir: string,
  args: string[],
  timeoutMs = 120_000
): Promise<TopoCliResult> {
  const result = await runProcess({
    program: process.execPath,
    args: [path.join(process.cwd(), 'out', 'cli', 'index.js'), ...args],
    env: {
      ...process.env,
      TOPO_USER_DATA_PATH: userDataDir,
      TOPO_DEV_CLI_INVOCATION: '1'
    },
    timeoutMs,
    maxOutputBytes: 4 * 1024 * 1024
  })
  let json: TopoCliResult['json'] = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = null
  }
  return {
    args,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    json
  }
}

/** The `--json` result of a command that must succeed; a failure names the command and its output. */
export async function topoCliResult<T>(
  userDataDir: string,
  args: string[],
  timeoutMs?: number
): Promise<T> {
  const run = await runCompiledTopoCli(userDataDir, [...args, '--json'], timeoutMs)
  if (run.code !== 0 || !run.json?.ok) {
    throw new Error(
      `topo ${args.join(' ')} exited ${run.code}: ${run.stdout.slice(0, 2_000)} ${run.stderr.slice(0, 2_000)}`
    )
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers name the shape the CLI's --json envelope documents for that command; tests assert on it.
  return run.json.result as T
}
