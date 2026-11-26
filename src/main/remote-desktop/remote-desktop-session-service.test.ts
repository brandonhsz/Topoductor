import { connect, createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteDesktopError } from '../../shared/remote-desktop/remote-desktop-contract'
import {
  RemoteDesktopSessionService,
  type RemoteDesktopForwards
} from './remote-desktop-session-service'

type FakeConnection = { isDisposed: () => boolean }

function fakeForwards(
  localPort = 0
): RemoteDesktopForwards<FakeConnection> & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    addForward: async () => ({ id: 'pf-1', localPort }),
    removeForwardAndWait: async (id) => {
      removed.push(id)
    },
    removeAllForwards: async () => undefined,
    closeAll: async () => undefined
  }
}

type Recorded = { data: Buffer[]; closed: (RemoteDesktopError | undefined)[] }

function recordingSink(): Recorded & {
  sink: { data: (bytes: Uint8Array) => void; closed: (error?: RemoteDesktopError) => void }
} {
  const recorded: Recorded = { data: [], closed: [] }
  return {
    ...recorded,
    sink: {
      data: (bytes) => recorded.data.push(Buffer.from(bytes)),
      closed: (error) => recorded.closed.push(error)
    }
  }
}

function until(check: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!check()) {
      throw new Error('not yet')
    }
  })
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
})

async function vncServer(): Promise<{ port: number; peers: Socket[]; received: Buffer[] }> {
  const peers: Socket[] = []
  const received: Buffer[] = []
  const server = createServer((socket) => {
    peers.push(socket)
    socket.on('data', (bytes) => received.push(bytes))
    socket.write('RFB 003.889\n')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { port: typeof address === 'object' && address ? address.port : 0, peers, received }
}

function directService(port: number): RemoteDesktopSessionService<FakeConnection> {
  return new RemoteDesktopSessionService({
    resolveRoute: () => ({ ok: true, route: { kind: 'direct', host: '127.0.0.1' } }),
    getSshConnection: () => undefined,
    loadCredential: async () => ({ username: 'admin', password: 'pw' }),
    forwards: fakeForwards(),
    connect: (host) => connect({ host, port })
  })
}

describe('RemoteDesktopSessionService', () => {
  it('relays bytes both ways and reports a server hang-up', async () => {
    const server = await vncServer()
    const service = directService(server.port)
    const recorded = recordingSink()

    const result = await service.open('runtime:env-1', recorded.sink)
    expect(result.ok).toBe(true)
    const sessionId = result.ok ? result.sessionId : ''
    await until(() => Buffer.concat(recorded.data).toString() === 'RFB 003.889\n')

    service.write(sessionId, new TextEncoder().encode('RFB 003.008\n'))
    await until(() => Buffer.concat(server.received).toString() === 'RFB 003.008\n')
    expect(await service.credentialFor(sessionId)).toEqual({ username: 'admin', password: 'pw' })

    server.peers[0].destroy()
    await until(() => recorded.closed.length === 1)
    expect(recorded.closed[0]?.code).toBe('session_lost')
    expect(await service.credentialFor(sessionId)).toBeNull()
  })

  it('closes quietly when the window ends the session', async () => {
    const server = await vncServer()
    const service = directService(server.port)
    const recorded = recordingSink()
    const result = await service.open('runtime:env-1', recorded.sink)
    const sessionId = result.ok ? result.sessionId : ''

    await service.close(sessionId)
    await service.close(sessionId)

    expect(recorded.closed).toEqual([undefined])
  })

  it('reports an unreachable screen sharing service and drops its tunnel', async () => {
    const closedServer = await vncServer()
    const port = closedServer.port
    await new Promise((done) => servers.pop()!.close(done))
    const forwards = fakeForwards(port)
    const service = new RemoteDesktopSessionService({
      resolveRoute: () => ({ ok: true, route: { kind: 'ssh', targetId: 'box' } }),
      getSshConnection: () => ({ isDisposed: () => false }),
      loadCredential: async () => null,
      forwards
    })

    const result = await service.open('ssh:box', recordingSink().sink)

    expect(result.ok ? null : result.error.code).toBe('vnc_unreachable')
    expect(forwards.removed).toEqual(['pf-1'])
  })

  it('asks for an SSH connection before tunneling', async () => {
    const service = new RemoteDesktopSessionService<FakeConnection>({
      resolveRoute: () => ({ ok: true, route: { kind: 'ssh', targetId: 'box' } }),
      getSshConnection: () => undefined,
      loadCredential: async () => null,
      forwards: fakeForwards()
    })

    const result = await service.open('ssh:box', recordingSink().sink)

    expect(result.ok ? null : result.error.code).toBe('ssh_not_connected')
  })
})
