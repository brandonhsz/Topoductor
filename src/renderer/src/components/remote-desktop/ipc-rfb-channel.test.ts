import { describe, expect, it, vi } from 'vitest'
import { IpcRfbChannel } from './ipc-rfb-channel'

function bytesOf(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)]
}

describe('IpcRfbChannel', () => {
  it('replays bytes that arrived before noVNC attached', () => {
    const channel = new IpcRfbChannel({ write: vi.fn(), close: vi.fn() })
    channel.receive(new Uint8Array([1, 2]).buffer)
    channel.receive(new Uint8Array([3]).buffer)

    const seen: number[][] = []
    channel.onmessage = (event) => seen.push(bytesOf(event.data))
    channel.receive(new Uint8Array([4]).buffer)

    expect(seen).toEqual([[1, 2], [3], [4]])
  })

  it('sends a copy that later queue reuse cannot change', () => {
    const written: ArrayBuffer[] = []
    const channel = new IpcRfbChannel({ write: (bytes) => written.push(bytes), close: vi.fn() })
    const queue = new Uint8Array([9, 8, 7, 6])

    channel.send(queue.subarray(1, 3))
    queue.fill(0)

    expect(written.map(bytesOf)).toEqual([[8, 7]])
  })

  it('reports a remote close once and stops sending', () => {
    const write = vi.fn()
    const channel = new IpcRfbChannel({ write, close: vi.fn() })
    const onclose = vi.fn()
    channel.onclose = onclose

    channel.remoteClosed('lost')
    channel.remoteClosed('lost again')
    channel.send(new Uint8Array([1]))

    expect(onclose).toHaveBeenCalledTimes(1)
    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1006, reason: 'lost' })
    expect(channel.readyState).toBe('closed')
    expect(write).not.toHaveBeenCalled()
  })
})
