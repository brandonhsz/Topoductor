import { connect as connectTcp, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { REMOTE_DESKTOP_DEFAULT_VNC_PORT } from '../../../../../shared/remote-desktop/remote-desktop-contract'
import {
  RemoteDesktopCloseParams,
  RemoteDesktopStreamParams,
  RemoteDesktopWriteParams,
  type RemoteDesktopStreamEvent
} from '../../../../../shared/rpc-contract/remote-desktop-params'
import { defineMethod, defineStreamingMethod } from '../../core'

const CONNECT_TIMEOUT_MS = 10_000
const LOOPBACK = '127.0.0.1'

type StreamSession = { socket: Socket; connectionId: string | undefined }

export type RemoteDesktopStreamDependencies = {
  connect: (host: string, port: number) => Socket
}

/** Streams this host's own VNC server to a paired client; bytes ride the client's encrypted RPC channel. */
export function createRemoteDesktopStreamMethods(
  dependencies: RemoteDesktopStreamDependencies = {
    connect: (host, port) => connectTcp({ host, port })
  }
) {
  const sessions = new Map<string, StreamSession>()

  return [
    defineStreamingMethod({
      name: 'remoteDesktop.stream',
      permission: 'desktop-control',
      params: RemoteDesktopStreamParams,
      handler: async (params, { runtime, connectionId, signal }, emit) => {
        const send = (event: RemoteDesktopStreamEvent): void => emit(event)
        // The client registry retires a stream only on `end`.
        const end = (closed: RemoteDesktopStreamEvent & { type: 'closed' }): void => {
          send(closed)
          emit({ type: 'end' })
        }
        const port = params?.port ?? REMOTE_DESKTOP_DEFAULT_VNC_PORT
        let socket: Socket
        try {
          socket = await connectSocket(dependencies.connect, LOOPBACK, port, signal)
        } catch (error) {
          if (!signal?.aborted) {
            end({
              type: 'closed',
              error: {
                code: 'vnc_unreachable',
                message: `Could not reach the screen sharing service on port ${port} (${describe(error)}). On a Mac, turn on Screen Sharing in System Settings > General > Sharing.`
              }
            })
          }
          return
        }
        const subscriptionId = `remote-desktop-${randomUUID()}`
        await new Promise<void>((resolve) => {
          let finished = false
          const finish = (error?: RemoteDesktopStreamEvent & { type: 'closed' }): void => {
            if (finished) {
              return
            }
            finished = true
            sessions.delete(subscriptionId)
            signal?.removeEventListener('abort', onAbort)
            socket.destroy()
            end(error ?? { type: 'closed' })
            resolve()
          }
          const onAbort = (): void => runtime.cleanupSubscription(subscriptionId)
          sessions.set(subscriptionId, { socket, connectionId })
          runtime.registerSubscriptionCleanup(subscriptionId, () => finish(), connectionId)
          signal?.addEventListener('abort', onAbort, { once: true })
          socket.setNoDelay(true)
          socket.on('data', (bytes: Buffer) => {
            if (!finished) {
              send({ type: 'data', data: bytes.toString('base64') })
            }
          })
          socket.on('error', () => undefined)
          socket.on('close', () => {
            finish({
              type: 'closed',
              error: { code: 'session_lost', message: 'The remote desktop connection closed.' }
            })
            runtime.cleanupSubscription(subscriptionId)
          })
          send({ type: 'ready', subscriptionId })
          if (signal?.aborted) {
            onAbort()
          }
        })
      }
    }),
    defineMethod({
      name: 'remoteDesktop.write',
      permission: 'desktop-control',
      params: RemoteDesktopWriteParams,
      handler: async (params, { connectionId }) => {
        const session = sessions.get(params.subscriptionId)
        // Only the socket that opened a session may type into it.
        if (!session || session.connectionId !== connectionId || session.socket.destroyed) {
          return { written: false }
        }
        session.socket.write(Buffer.from(params.data, 'base64'))
        return { written: true }
      }
    }),
    defineMethod({
      name: 'remoteDesktop.close',
      permission: 'desktop-control',
      params: RemoteDesktopCloseParams,
      handler: async (params, { runtime, connectionId }) => ({
        closed: runtime.cleanupSubscriptionIfOwnedByConnection(params.subscriptionId, connectionId)
      })
    })
  ] as const
}

function connectSocket(
  connect: RemoteDesktopStreamDependencies['connect'],
  host: string,
  port: number,
  signal: AbortSignal | undefined
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const socket = connect(host, port)
    const fail = (error: Error): void => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('timed out')), CONNECT_TIMEOUT_MS)
    const onAbort = (): void => fail(new Error('aborted'))
    const onConnect = (): void => {
      cleanup()
      resolve(socket)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket.off('connect', onConnect)
      socket.off('error', fail)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    socket.once('connect', onConnect)
    socket.once('error', fail)
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const REMOTE_DESKTOP_STREAM_METHODS = createRemoteDesktopStreamMethods()
