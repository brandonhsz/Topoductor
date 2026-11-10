import { ghExecFileAsync, acquire, release } from '../../gh-utils'
import { runAsDefaultWslCliUserAct } from '../../../git/command-runner/default-wsl-cli-fallback'
export const TOPO_REPO = 'brandonhsz/Topoductor'

// Bound optional star prompts more tightly than user work; failures can fall back to the browser.
const STAR_GH_TIMEOUT_MS = 15_000

let inFlightStarCheck: Promise<boolean | null> | null = null

/** null means the star state could not be determined. */
export function checkTopoStarred(): Promise<boolean | null> {
  // Independent UI callers share one probe so optional star prompts cannot exhaust GitHub admission.
  inFlightStarCheck ??= runTopoStarredCheck().finally(() => {
    inFlightStarCheck = null
  })
  return inFlightStarCheck
}

/** @internal Drop any coalesced check so suites cannot inherit one another's. */
export function __resetTopoStarCheckForTests(): void {
  inFlightStarCheck = null
}

async function runTopoStarredCheck(): Promise<boolean | null> {
  await acquire()
  try {
    const { stdout, stderr } = await ghExecFileAsync(
      ['api', '--include', `user/starred/${TOPO_REPO}`],
      { encoding: 'utf-8', timeout: STAR_GH_TIMEOUT_MS }
    )
    const response = `${stdout ?? ''}\n${stderr ?? ''}`
    if (/HTTP\/\S+\s+(?:200|204)\b/.test(response)) {
      return true
    }
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Only a confirmed 404 establishes that the user has not starred.
    if (message.includes('HTTP 404')) {
      return false
    }
    return null
  } finally {
    release()
  }
}

export async function starTopo(): Promise<boolean> {
  await acquire()
  try {
    // Starring is always a click, so it may start the stopped distro its gh lives in (E9).
    await runAsDefaultWslCliUserAct(() =>
      ghExecFileAsync(['api', '-X', 'PUT', `user/starred/${TOPO_REPO}`], {
        encoding: 'utf-8',
        timeout: STAR_GH_TIMEOUT_MS
      })
    )
    return true
  } catch {
    return false
  } finally {
    release()
  }
}
