// Live terminals block idle exit; ordinary shutdown disconnects without killing their daemon.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RELAY_INSTALL_LOCK_NAME } from '../../shared/relay-install-lock-name'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'
import type { RuntimeRpcClientActivity } from '../runtime/rpc/server/runtime-rpc'
import { TOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/topod-managed-launch-env'
import {
  TOPOD_IDLE_EXIT_TIMEOUT_MS,
  readTopodE2EIdleTimeoutMs,
  readTopodIdleTimeoutMs
} from '../../shared/topod-idle-exit'
import {
  TopodIdleExitMonitor,
  type TopodIdleExitEvidence,
  type TopodIdleProbe,
  type TopodIdleVerdict
} from './topod-idle-exit-monitor'

export type TopodManagedIdleExitConfig = { timeoutMs: number; activationRoot: string }

/** User-started/paired servers never idle out; only client-managed launches opt in. */
export function resolveTopodManagedIdleExit(
  env: NodeJS.ProcessEnv
): TopodManagedIdleExitConfig | null {
  const activationRoot = env[TOPOD_MANAGED_ACTIVATION_ROOT_ENV]
  if (!activationRoot) {
    return null
  }
  return {
    timeoutMs:
      readTopodE2EIdleTimeoutMs(env) ?? readTopodIdleTimeoutMs(env) ?? TOPOD_IDLE_EXIT_TIMEOUT_MS,
    activationRoot
  }
}

export type TopodManagedIdleExitPorts = {
  readClientActivity: () => RuntimeRpcClientActivity
  listTerminals: () => Promise<readonly unknown[]>
  /** Null means some daemon generation did not answer. */
  countDaemonSessions: () => Promise<number | null>
  hasDaemon: () => boolean
  agentStates: () => readonly { state: string }[]
  hasChatProviders: () => boolean
  hasStagedMigration: () => boolean
  /** Enabled schedules or unsettled runs would be lost on exit. */
  automationsBusy: () => boolean
  /** Exit would shut down the emulators Topo started for a workspace. */
  emulatorsBusy: () => Promise<boolean>
  activationFenceExists: (root: string) => Promise<boolean>
}

export function createTopodIdleProbes(
  config: TopodManagedIdleExitConfig,
  ports: TopodManagedIdleExitPorts
): TopodIdleProbe[] {
  const verdict = (busy: boolean): TopodIdleVerdict => (busy ? 'busy' : 'idle')
  return [
    {
      name: 'clients',
      read: () => {
        const activity = ports.readClientActivity()
        return verdict(activity.openConnections > 0 || activity.requestsInFlight > 0)
      }
    },
    {
      name: 'terminals',
      read: async () => {
        if ((await ports.listTerminals()).length > 0) {
          return 'busy'
        }
        // Daemons may retain sessions absent from this process’s provider inventory.
        if (!ports.hasDaemon()) {
          return 'idle'
        }
        const live = await ports.countDaemonSessions()
        return live === null ? 'unverifiable' : verdict(live > 0)
      }
    },
    {
      name: 'agents',
      read: () => verdict(ports.agentStates().some((entry) => entry.state === 'working'))
    },
    { name: 'chat-providers', read: () => verdict(ports.hasChatProviders()) },
    { name: 'migration', read: () => verdict(ports.hasStagedMigration()) },
    { name: 'automations', read: () => verdict(ports.automationsBusy()) },
    { name: 'emulators', read: async () => verdict(await ports.emulatorsBusy()) },
    {
      name: 'activation',
      read: async () => verdict(await ports.activationFenceExists(config.activationRoot))
    }
  ]
}

/** A bare activation root may be interrupted acquisition; only its lock proves a held fence. */
export async function activationFenceExists(root: string): Promise<boolean> {
  try {
    await stat(join(root, RELAY_INSTALL_LOCK_NAME))
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

export function installTopodManagedIdleExit(input: {
  config: TopodManagedIdleExitConfig
  ports: TopodManagedIdleExitPorts
  stop: (evidence: TopodIdleExitEvidence) => void | boolean | Promise<void | boolean>
}): () => void {
  const monitor = new TopodIdleExitMonitor({
    timeoutMs: input.config.timeoutMs,
    probes: createTopodIdleProbes(input.config, input.ports),
    lastClientActivityAt: () => input.ports.readClientActivity().lastRequestAt,
    onIdle: input.stop
  })
  monitor.start()
  return () => monitor.stop()
}
