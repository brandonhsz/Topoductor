import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'
import { createRemoteDesktopStreamMethods } from './remote-desktop-stream'

class FakeSocket extends EventEmitter {
  destroyed = false
  written: Buffer[] = []
  setNoDelay = vi.fn()
  write(bytes: Buffer): boolean {
    this.written.push(bytes)
    return true
  }
  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true
      this.emit('close')
    }
  }
}

function fakeRuntime() {
  const cleanups = new Map<string, { run: () => void; connectionId?: string }>()
  return {
    registerSubscriptionCleanup: (id: string, run: () => void, connectionId?: string) => {
      cleanups.set(id, { run, connectionId })
    },
    cleanupSubscription: (id: string) => {
      const entry = cleanups.get(id)
      cleanups.delete(id)
      entry?.run()
    },
    cleanupSubscriptionIfOwnedByConnection: (id: string, connectionId?: string) => {
      const entry = cleanups.get(id)
      if (!entry || entry.connectionId !== connectionId) {
        return false
      }
      cleanups.delete(id)
      entry.run()
      return true
    }
  }
}

function setup(connectOutcome: 'connect' | 'refuse' = 'connect') {
  const socket = new FakeSocket()
  const connect = vi.fn(() => {
    queueMicrotask(() =>
      connectOutcome === 'connect'
        ? socket.emit('connect')
        : socket.emit('error', new Error('ECONNREFUSED'))
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service touches only the Socket members FakeSocket implements.
    return socket as unknown as Socket
  })
  const [stream, write, close] = createRemoteDesktopStreamMethods({ connect })
  const runtime = fakeRuntime()
  const events: unknown[] = []
  const ctx = (connectionId: string): RpcContext =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers read only the subscription members fakeRuntime provides.
    ({ runtime, connectionId }) as unknown as RpcContext
  const done = stream.handler({}, ctx('conn-a'), (event) => {
    events.push(event)
  })
  return { socket, connect, write, close, runtime, events, ctx, done }
}

async function readySubscription(events: unknown[]): Promise<string> {
  await vi.waitFor(() => expect(events[0]).toMatchObject({ type: 'ready' }))
  const ready = events[0]
  const subscriptionId =
    typeof ready === 'object' && ready !== null && 'subscriptionId' in ready
      ? ready.subscriptionId
      : null
  if (typeof subscriptionId !== 'string') {
    throw new Error('ready frame carried no subscription id')
  }
  return subscriptionId
}

describe('remoteDesktop.stream', () => {
  it('connects to the host’s own VNC port and relays bytes both ways', async () => {
    const { socket, connect, write, events, ctx } = setup()
    const subscriptionId = await readySubscription(events)
    expect(connect).toHaveBeenCalledWith('127.0.0.1', 5900)

    socket.emit('data', Buffer.from('RFB 003.008\n'))
    expect(events[1]).toEqual({
      type: 'data',
      data: Buffer.from('RFB 003.008\n').toString('base64')
    })

    await write.handler(
      { subscriptionId, data: Buffer.from('hi').toString('base64') },
      ctx('conn-a')
    )
    expect(socket.written.map(String)).toEqual(['hi'])
  })

  it('ignores writes and closes from another connection', async () => {
    const { socket, write, close, events, ctx } = setup()
    const subscriptionId = await readySubscription(events)

    expect(await write.handler({ subscriptionId, data: 'aGk=' }, ctx('conn-b'))).toEqual({
      written: false
    })
    expect(await close.handler({ subscriptionId }, ctx('conn-b'))).toEqual({ closed: false })
    expect(socket.written).toHaveLength(0)
    expect(socket.destroyed).toBe(false)
  })

  it('ends the stream when its owner closes it', async () => {
    const { socket, close, events, ctx, done } = setup()
    const subscriptionId = await readySubscription(events)

    expect(await close.handler({ subscriptionId }, ctx('conn-a'))).toEqual({ closed: true })
    await done
    expect(socket.destroyed).toBe(true)
    expect(events.slice(-2)).toEqual([{ type: 'closed' }, { type: 'end' }])
  })

  it('reports a lost session when the VNC server hangs up', async () => {
    const { socket, events, done } = setup()
    await readySubscription(events)

    socket.destroy()
    await done
    expect(events.slice(-2)).toEqual([
      {
        type: 'closed',
        error: { code: 'session_lost', message: 'The remote desktop connection closed.' }
      },
      { type: 'end' }
    ])
  })

  it('reports an unreachable VNC server without opening a session', async () => {
    const { events, done } = setup('refuse')
    await done
    expect(events[0]).toMatchObject({ type: 'closed', error: { code: 'vnc_unreachable' } })
    expect(events[1]).toEqual({ type: 'end' })
  })
})
