import { getAppEnvironment } from '../../shared/app-environment'
import type { RuntimeRpcClientActivity } from '../runtime/rpc/server/runtime-rpc'
import type { TopodIdleExitEvidence } from './topod-idle-exit-monitor'
import {
  activationFenceExists,
  createTopodIdleProbes,
  installTopodManagedIdleExit,
  resolveTopodManagedIdleExit,
  type TopodManagedIdleExitConfig,
  type TopodManagedIdleExitPorts
} from './topod-managed-idle-exit'
import type { TopodDaemonRetirement } from './topod-daemon-retirement'
import { recoverDaemonAfterCancelledIdleStop } from './topod-idle-stop-daemon-recovery'
import {
  consumeTopodIdleStopRecord,
  discardTopodIdleStopRecord,
  writeTopodIdleStopRecord
} from './topod-idle-stop-record'
import type { TopodShutdownTrigger } from './topod-lifecycle'
import {
  idleStopMayReleaseWslHolder,
  requestTopodWslHolderRelease,
  withdrawTopodWslHolderRelease
} from './topod-wsl-holder-release'
import type { TopodIdleStopRecord } from '../../shared/topod-idle-exit'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'

let requestIdleShutdown: TopodShutdownTrigger | null = null

/** Signal handling binds later; the quiet period must outlast the startup gap. */
export function bindTopodIdleShutdown(request: TopodShutdownTrigger): void {
  requestIdleShutdown = request
}

type TopodIdleExitRuntimePorts = {
  rpc: { readClientActivity(): RuntimeRpcClientActivity }
  agentStates: () => readonly { state: string }[]
  hasStagedMigration: () => boolean
  automationsBusy: () => boolean
  emulatorsBusy: () => Promise<boolean>
  /** Stop the monitor before recording signal-driven shutdown. */
  registerCleanup: (cleanup: () => void) => void
}

/** Under the startup lock, consume previous idle-stop evidence before this run can overwrite it. */
export function beginTopodIdleExit(userDataPath: string): {
  previousIdleStop: TopodIdleStopRecord | null | undefined
  start: (ports: TopodIdleExitRuntimePorts) => Promise<void>
} {
  withdrawTopodWslHolderRelease(userDataPath)
  const config = resolveTopodManagedIdleExit(process.env)
  if (!config) {
    return { previousIdleStop: undefined, start: async () => {} }
  }
  const previousIdleStop = consumeTopodIdleStopRecord(userDataPath)
  if (previousIdleStop) {
    console.error(`[topod] the previous run stopped idle at ${previousIdleStop.stoppedAt}`)
  }
  const version = getAppEnvironment().getVersion()
  return {
    previousIdleStop,
    start: (ports) => startTopodManagedIdleExit({ ...ports, config, userDataPath, version })
  }
}

async function startTopodManagedIdleExit(
  input: TopodIdleExitRuntimePorts & {
    config: TopodManagedIdleExitConfig
    userDataPath: string
    version: string
  }
): Promise<void> {
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { getCurrentDaemonPid, getDaemonEndpointFacts, isDaemonTerminalAdmissionClosed } =
    await import('../daemon/providers/lifecycle/daemon-provider-state')
  const { countLiveTopodDaemonSessions, retireTopodDaemonIfIdle } =
    await import('./topod-daemon-retirement')
  const idleRecord = createIdleStopRecordOwnership(input.userDataPath)
  const hasChatProviders = (): boolean =>
    getStructuredAgentSessionHost()?.hasLoadedProviders() ?? false
  const ports: TopodManagedIdleExitPorts = {
    readClientActivity: () => input.rpc.readClientActivity(),
    listTerminals: () => getLocalPtyProvider().listProcesses(),
    countDaemonSessions: countLiveTopodDaemonSessions,
    hasDaemon: () => getDaemonEndpointFacts() !== null,
    agentStates: input.agentStates,
    hasChatProviders,
    hasStagedMigration: input.hasStagedMigration,
    automationsBusy: input.automationsBusy,
    emulatorsBusy: input.emulatorsBusy,
    activationFenceExists
  }
  // Client/terminal evidence is already checked; recheck other work exit would destroy.
  const nonTerminalWorkProbes = createTopodIdleProbes(input.config, ports).filter(
    (probe) => probe.name !== 'clients' && probe.name !== 'terminals'
  )
  const hasNonTerminalWork = async (): Promise<boolean> => {
    for (const probe of nonTerminalWorkProbes) {
      if (
        (await Promise.resolve()
          .then(probe.read)
          .catch(() => 'unverifiable')) !== 'idle'
      ) {
        return true
      }
    }
    return false
  }
  const dispose = installTopodManagedIdleExit({
    config: input.config,
    ports,
    stop: async (evidence) => {
      // Replacement must target only the daemon incarnation that agreed to retire.
      const retiringPid = getCurrentDaemonPid()
      const outcome = await stopForIdle(input, evidence, retireTopodDaemonIfIdle)
      // Clients/providers can return while the retirement reply is pending.
      const activity = input.rpc.readClientActivity()
      if (
        hasChatProviders() ||
        activity.openConnections > 0 ||
        activity.requestsInFlight > 0 ||
        activity.lastRequestAt > evidence.quietSince
      ) {
        discardTopodIdleStopRecord(input.userDataPath)
        const daemon = await recoverDaemonAfterCancelledIdleStop(outcome, {
          admissionClosed: isDaemonTerminalAdmissionClosed,
          retireAgain: () => retireTopodDaemonIfIdle(),
          replaceDaemon: async () => {
            if (retiringPid === null) {
              throw new Error('the retiring daemon never identified itself')
            }
            const { restartDaemon } =
              await import('../daemon/providers/lifecycle/daemon-provider-restart')
            await restartDaemon({ expectedDaemonPid: retiringPid, endpointMayBeGone: true })
          }
        })
        if (daemon === 'serving' || (await hasNonTerminalWork())) {
          return false
        }
        idleRecord.requestShutdown(requestIdleShutdown)
        return true
      }
      if (idleStopMayReleaseWslHolder(process.env, outcome)) {
        try {
          requestTopodWslHolderRelease(input.userDataPath)
        } catch (error) {
          console.error('[topod] could not release the WSL distro holder:', error)
        }
      }
      idleRecord.requestShutdown(requestIdleShutdown)
      return true
    }
  })
  input.registerCleanup(() => {
    dispose()
    idleRecord.onShutdown()
  })
}

/** Discard failed, overdue and externally superseded idle stops, including cleanup before request completion. */
export function createIdleStopRecordOwnership(userDataPath: string): {
  requestShutdown(request: TopodShutdownTrigger | null): void
  onShutdown(): void
} {
  let idleOwnsStop = false
  // The holder release rides on the idle stop: a stop that is not idle must not end the distro.
  const discard = (): void => {
    discardTopodIdleStopRecord(userDataPath)
    withdrawTopodWslHolderRelease(userDataPath)
  }
  return {
    requestShutdown: (request) => {
      // Cleanup may run before the trigger returns, so establish ownership first.
      idleOwnsStop = true
      if (request?.('idle', discard) !== true) {
        idleOwnsStop = false
        discard()
      }
    },
    onShutdown: () => {
      if (!idleOwnsStop) {
        discard()
      }
    }
  }
}

async function stopForIdle(
  input: { userDataPath: string; version: string },
  evidence: TopodIdleExitEvidence,
  retireDaemon: () => Promise<TopodDaemonRetirement>
): Promise<TopodDaemonRetirement> {
  console.error(`[topod] stopping: no client, terminal or job for ${evidence.timeoutMs}ms`)
  try {
    writeTopodIdleStopRecord(input.userDataPath, evidence, input.version)
  } catch (error) {
    console.error('[topod] could not record the idle stop:', error)
  }
  // Only the daemon’s atomic empty census can authorize retirement.
  const outcome = await retireDaemon().catch((error: unknown): TopodDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: String(error)
  }))
  console.error(
    `[topod] terminal daemon on idle stop: ${outcome.retirement}${outcome.reason ? ` (${outcome.reason})` : ''}`
  )
  return outcome
}
