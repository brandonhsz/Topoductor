import { startTopod } from './topod-entry'
import process from 'node:process'
import { resolveTopodInstallRoot } from './topod-app-paths'
import { TOPOD_USAGE, parseArgs } from './topod-command-arguments'
import { installTopodShutdownSignals, type TopodShutdownTrigger } from './topod-lifecycle'
import { installTopodProcessErrorGuards } from './topod-process-error-guards'
import { installTopodStopRequestListeners } from './topod-stop-request-listener'
import { prepareTopodManagedStop } from './topod-managed-stop-admission'
import { bindTopodIdleShutdown } from './topod-managed-idle-exit-host'

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(TOPOD_USAGE)
    return
  }
  let shutdownTrigger: TopodShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installTopodProcessErrorGuards(() => shutdownTrigger)
  const startup = startTopod(options)
  const requestShutdown = installTopodShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installTopodStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveTopodInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareTopodManagedStop
  })
  bindTopodIdleShutdown(requestShutdown)
}
