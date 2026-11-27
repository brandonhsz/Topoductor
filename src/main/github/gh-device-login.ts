import { spawn, type ChildProcess } from 'node:child_process'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import type {
  GitHubHostSignInResult,
  HostAccountSignInChannel
} from '../../shared/host-account-sign-in-types'
import {
  execLocalPreflightCommandOrThrow,
  findRunnableLocalCommand
} from '../ipc/preflight-command-exec'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { _resetPreflightCache } from '../preflight/agent-detection'
import { resetGhLoginCache } from '../git/git-username'

const GITHUB_HOSTNAME = 'github.com'
// Matches GitHub's 15-minute device-code validity.
export const GH_DEVICE_LOGIN_TIMEOUT_MS = 900_000
const FOLLOW_UP_TIMEOUT_MS = 20_000
const MAX_OUTPUT_CHARS = 8_000
// Env tokens override the keyring login, so a fresh sign-in would still look invalid.
const TOKEN_ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN'
]

/** Reads gh's device prompt: «One-time code (ABCD-1234)» or «one-time code: ABCD-1234», plus the device URL. */
export function parseGhDeviceLoginPrompt(output: string): { url: string; userCode: string } | null {
  const plain = stripAnsiEscapeSequences(output)
  const code = /one-time code\W+([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(plain)
  const url = /https:\/\/github\.com\/login\/device\b/.exec(plain)
  return code && url ? { url: url[0], userCode: code[1].toUpperCase() } : null
}

export type GhDeviceLoginDeps = {
  findGh: () => Promise<string | null>
  spawnLogin: (binary: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess
  run: (binary: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>
  env: () => NodeJS.ProcessEnv
  onSignedIn: () => void
}

const defaultDeps: GhDeviceLoginDeps = {
  findGh: async () => {
    const probe = await findRunnableLocalCommand('gh')
    return probe.status === 'available' ? probe.binary : null
  },
  spawnLogin: (binary, args, env) =>
    spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
  run: async (binary, args, env) =>
    (await execLocalPreflightCommandOrThrow(binary, args, { env, timeoutMs: FOLLOW_UP_TIMEOUT_MS }))
      .stdout,
  env: () => ({ ...(buildLocalPreflightEnv() ?? process.env) }),
  onSignedIn: () => {
    resetGhLoginCache()
    _resetPreflightCache()
  }
}

function loginEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const key of TOKEN_ENV_KEYS) {
    delete env[key]
  }
  return env
}

/** Signs this host's `gh` in to github.com by device code, then points git's https credentials at it. */
export async function runGhDeviceLogin(
  channel: HostAccountSignInChannel,
  deps: GhDeviceLoginDeps = defaultDeps
): Promise<GitHubHostSignInResult> {
  const binary = await deps.findGh()
  if (!binary) {
    throw new Error('GitHub CLI (gh) is not installed on this host. Install it, then try again.')
  }
  const env = loginEnv(deps.env())
  await new Promise<void>((resolve, reject) => {
    const child = deps.spawnLogin(
      binary,
      [
        'auth',
        'login',
        '--hostname',
        GITHUB_HOSTNAME,
        '--git-protocol',
        'https',
        '--web',
        '--skip-ssh-key'
      ],
      env
    )
    let output = ''
    let prompted = false
    let done = false
    const finish = (error?: Error): void => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timeout)
      channel.signal.removeEventListener('abort', onAbort)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onAbort = (): void => {
      child.kill()
      finish(new Error('GitHub sign-in was cancelled.'))
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('GitHub sign-in took too long to finish. Please try again.'))
    }, GH_DEVICE_LOGIN_TIMEOUT_MS)
    const read = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS)
      const prompt = prompted ? null : parseGhDeviceLoginPrompt(output)
      if (prompt) {
        prompted = true
        channel.onPrompt({ ...prompt, needsCode: false })
      }
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      const detail = stripAnsiEscapeSequences(output).trim()
      finish(
        code === 0
          ? undefined
          : new Error(
              detail ? `gh auth login failed: ${detail}` : `gh auth login exited with code ${code}.`
            )
      )
    })
    if (channel.signal.aborted) {
      onAbort()
    } else {
      channel.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  // Git over https asks gh for credentials only once gh is its credential helper.
  await deps.run(binary, ['auth', 'setup-git', '--hostname', GITHUB_HOSTNAME], env)
  const login = (
    await deps.run(binary, ['api', 'user', '--jq', '.login'], env).catch(() => '')
  ).trim()
  deps.onSignedIn()
  return { login: login || null }
}
