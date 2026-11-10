import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activationFenceExists,
  createTopodIdleProbes,
  type TopodManagedIdleExitPorts
} from './topod-managed-idle-exit'

const config = { timeoutMs: 1_000, activationRoot: '/home/u/.topo-remote/.fence' }

function idlePorts(): TopodManagedIdleExitPorts {
  return {
    readClientActivity: () => ({ openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }),
    listTerminals: async () => [],
    countDaemonSessions: async () => 0,
    hasDaemon: () => true,
    agentStates: () => [{ state: 'done' }],
    hasChatProviders: () => false,
    hasStagedMigration: () => false,
    automationsBusy: () => false,
    emulatorsBusy: async () => false,
    activationFenceExists: async () => false
  }
}

async function verdicts(ports: TopodManagedIdleExitPorts): Promise<Record<string, string>> {
  const entries = await Promise.all(
    createTopodIdleProbes(config, ports).map(async (probe) => [probe.name, await probe.read()])
  )
  return Object.fromEntries(entries)
}

describe('createTopodIdleProbes', () => {
  it('treats a daemon that did not answer as unverifiable, not as no terminals', async () => {
    const result = await verdicts({ ...idlePorts(), countDaemonSessions: async () => null })
    expect(result.terminals).toBe('unverifiable')
  })

  it('needs only the provider census when this topod runs without a daemon', async () => {
    const result = await verdicts({
      ...idlePorts(),
      hasDaemon: () => false,
      countDaemonSessions: async () => null
    })
    expect(result.terminals).toBe('idle')
  })
})

describe('activationFenceExists', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('follows the lock a client holds during an update, not a root an aborted acquire left', async () => {
    root = mkdtempSync(join(tmpdir(), 'topod-fence-'))
    const fence = join(root, '.topod-activation-transaction')
    expect(await activationFenceExists(fence)).toBe(false)
    mkdirSync(fence)
    expect(await activationFenceExists(fence)).toBe(false)
    mkdirSync(join(fence, '.install-lock'))
    expect(await activationFenceExists(fence)).toBe(true)
  })
})
