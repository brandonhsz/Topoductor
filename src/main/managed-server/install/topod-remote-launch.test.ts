import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { topodLivenessProbeCommand, parseTopodLiveness } from './topod-remote-launch'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

const posix = getRemoteHostPlatform('linux-x64')
getRemoteHostPlatform('win32-x64')
JSON.stringify({
  type: 'topo_server_ready',
  schemaVersion: 1,
  runtimeId: 'r1',
  boundEndpoint: 'ws://127.0.0.1:7777',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
  health: { buildHash: 'abc', terminalDaemon: { state: 'live' } }
})

describe('liveness', () => {
  // Real host (win-lowspec): after a distro restart the probe's own shell took the recorded PID.
  describe.skipIf(process.platform === 'win32')(
    'a recorded PID after a restart (real shell)',
    () => {
      const probeIn = (script: string): string =>
        spawnSync('sh', ['-c', script], { encoding: 'utf8' }).stdout

      async function withSlot(run: (slot: string, probe: string) => Promise<void>): Promise<void> {
        const slot = mkdtempSync(join(tmpdir(), 'topod-liveness-'))
        try {
          await run(slot, topodLivenessProbeCommand(posix, slot))
        } finally {
          rmSync(slot, { recursive: true, force: true })
        }
      }

      it('calls dead a PID held by the probe shell or the shell wrapping it', async () => {
        await withSlot(async (slot, probe) => {
          const own = probeIn(`echo $$ > '${slot}/.topod-pid'; ${probe}`)
          expect(parseTopodLiveness(own)).toBe('DEAD')
          // The trailing `:` stops dash and bash from exec'ing the inner shell into the outer's PID.
          const wrapped = probeIn(
            `echo $$ > '${slot}/.topod-pid'; sh -c ${JSON.stringify(probe).replace(/\$/g, '\\$')}; :`
          )
          expect(parseTopodLiveness(wrapped)).toBe('DEAD')
        })
      })
    }
  )
})
