import '../unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { TopoRuntimeService } from '../../topo-runtime'
import { defineMethod } from '../core'
import { TopoRuntimeRpcServer } from './runtime-rpc'
import {
  _resetTopodFeatureReadinessForTests,
  installTopodFeatureReadiness
} from '../topod-feature-readiness'

// A short RPC gets no handler signal, but a caller that disconnects mid feature-wait is never run.
it('refuses a gated short RPC whose local caller disconnects while it waits', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'local-disconnect-feature-wait-'))
  const ran = vi.fn()
  const readiness = installTopodFeatureReadiness()
  const server = new TopoRuntimeRpcServer({
    runtime: new TopoRuntimeService(),
    userDataPath,
    methods: [
      defineMethod({
        name: 'aiVault.searchStatus',
        requires: ['sessionSearch'],
        permission: 'workspace',
        params: null,
        handler: () => {
          ran()
          return {}
        }
      })
    ]
  })
  const disconnect = new AbortController()
  try {
    const pending = server['handleMessage'](
      JSON.stringify({
        id: 'req-1',
        method: 'aiVault.searchStatus',
        authToken: server['authToken']
      }),
      { signal: disconnect.signal, startKeepalive: vi.fn() }
    )
    disconnect.abort()
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'runtime_unavailable' }
    })
    readiness.open('sessionSearch')
    await Promise.resolve()
    expect(ran).not.toHaveBeenCalled()
  } finally {
    _resetTopodFeatureReadinessForTests()
    await server.stop()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})
