import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { mergeCursorTopoMcpConfig } from '../../shared/mcp/cursor-topo-mcp-config'
import type { ResolvedTopoMcpServer } from '../../shared/mcp/topo-mcp-resolution'
import { asRecord } from '../../shared/workspace-setup/setup-script-import-parsers'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'

const CURSOR_MCP_FILE = '.cursor/mcp.json'

type ManagedState = { managedNames: string[]; createdByTopo: boolean }

function statePath(userDataPath: string, folder: string): string {
  const key = createHash('sha256').update(resolve(folder)).digest('hex').slice(0, 24)
  return join(userDataPath, 'topo-mcp', 'cursor', `${key}.json`)
}

async function readState(path: string): Promise<ManagedState> {
  try {
    const raw = asRecord(JSON.parse(await readFile(path, 'utf8')))
    const names = Array.isArray(raw?.managedNames) ? raw.managedNames : []
    return {
      managedNames: names.filter((name): name is string => typeof name === 'string'),
      createdByTopo: raw?.createdByTopo === true
    }
  } catch {
    return { managedNames: [], createdByTopo: false }
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function git(folder: string, args: string[]): Promise<string | null> {
  try {
    // Host Git on purpose: Cursor runs only on this host, and these are quick path reads.
    return (await gitExecFileAsync(args, { cwd: folder, hostGit: true })).stdout.trim()
  } catch {
    return null
  }
}

/** Keeps a file Topo created out of `git status`; folders outside git need nothing. */
async function excludeFromGit(folder: string): Promise<void> {
  const excludePath = await git(folder, ['rev-parse', '--git-path', 'info/exclude'])
  if (!excludePath) {
    return
  }
  const absolute = isAbsolute(excludePath) ? excludePath : join(folder, excludePath)
  const current = (await readOptional(absolute)) ?? ''
  if (current.split(/\r?\n/).includes(`/${CURSOR_MCP_FILE}`)) {
    return
  }
  await mkdir(dirname(absolute), { recursive: true })
  await appendFile(
    absolute,
    `${current && !current.endsWith('\n') ? '\n' : ''}/${CURSOR_MCP_FILE}\n`
  )
}

export type CursorTopoMcpSync =
  | { kind: 'synced' }
  | { kind: 'skipped'; reason: 'tracked' | 'unreadable' }

/** Writes Topo's servers into the folder's `.cursor/mcp.json`, the only MCP source cursor-agent reads per project. */
export async function syncCursorTopoMcpFile(args: {
  folder: string
  userDataPath: string
  servers: readonly ResolvedTopoMcpServer[]
}): Promise<CursorTopoMcpSync> {
  const filePath = join(args.folder, CURSOR_MCP_FILE)
  const stateFile = statePath(args.userDataPath, args.folder)
  const state = await readState(stateFile)
  const existing = await readOptional(filePath)
  if (!existing && !args.servers.length) {
    return { kind: 'synced' }
  }
  // Rewriting a committed file would leave Topo's entries in the user's diff.
  if (existing !== null && (await git(args.folder, ['ls-files', '--', CURSOR_MCP_FILE]))) {
    return { kind: 'skipped', reason: 'tracked' }
  }
  const createdByTopo = existing === null || state.createdByTopo
  const merged = mergeCursorTopoMcpConfig({
    existing,
    previouslyManaged: state.managedNames,
    createdByTopo,
    servers: args.servers
  })
  if (merged.kind === 'unchanged') {
    return existing === null || !args.servers.length
      ? { kind: 'synced' }
      : { kind: 'skipped', reason: 'unreadable' }
  }
  if (merged.content === null) {
    await rm(filePath, { force: true })
  } else {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, merged.content, 'utf8')
    if (createdByTopo) {
      await excludeFromGit(args.folder)
    }
  }
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      managedNames: merged.managedNames,
      createdByTopo: merged.content !== null && createdByTopo
    }),
    'utf8'
  )
  return { kind: 'synced' }
}
