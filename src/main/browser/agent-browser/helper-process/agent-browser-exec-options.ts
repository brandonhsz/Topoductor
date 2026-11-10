import type { BrowserError } from '../../browser-error'

export type AgentBrowserExecOptions = {
  envOverrides?: NodeJS.ProcessEnv
  timeoutMs?: number
  timeoutError?: BrowserError
  /** The caller owns stdin, so the command goes as argv; only for Topo-authored tokens. */
  stdinText?: string
  /** Send tokens as argv so global options apply; only for Topo-authored or raw CLI tokens. */
  cliArgv?: boolean
}
