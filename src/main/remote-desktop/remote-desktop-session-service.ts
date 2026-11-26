import { connect as connectTcp, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  REMOTE_DESKTOP_DEFAULT_VNC_PORT,
  type RemoteDesktopCredentialInput,
  type RemoteDesktopError,
  type RemoteDesktopHostId,
  type RemoteDesktopOpenResult
} from '../../shared/remote-desktop/remote-desktop-contract'
import type { RemoteDesktopRouteResult } from './remote-desktop-route'

const CONNECT_TIMEOUT_MS = 10_000
const FORWARD_LABEL = 'remote-desktop'

export type RemoteDesktopSessionSink = {
  data: (bytes: Uint8Array) => void
  closed: (error?: RemoteDesktopError) => void
}

type RemoteDesktopConnection = { isDisposed: () => boolean }

/** The slice of SshPortForwardManager the service drives. */
export type RemoteDesktopForwards<Conn> = {
  addForward: (
    connectionId: string,
    conn: Conn,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    label?: string
  ) => Promise<{ id: string; localPort: number }>
  removeForwardAndWait: (id: string) => Promise<unknown>
  removeAllForwards: (connectionId: string) => Promise<void>
  closeAll: () => Promise<void>
}

export type RemoteDesktopSessionServiceDependencies<Conn extends RemoteDesktopConnection> = {
  resolveRoute: (hostId: RemoteDesktopHostId) => RemoteDesktopRouteResult
  getSshConnection: (targetId: string) => Conn | undefined
  loadCredential: (hostId: RemoteDesktopHostId) => Promise<RemoteDesktopCredentialInput | null>
  /** Kept apart from user forwards so remote desktop tunnels are never persisted or listed in Ports. */
  forwards: RemoteDesktopForwards<Conn>
  connect?: (host: string, port: number) => Socket
}

type Session = {
  id: string
  hostId: RemoteDesktopHostId
  sink: RemoteDesktopSessionSink
  socket: Socket
  targetId: string | null
  forwardId: string | null
  closed: boolean
}

export class RemoteDesktopSessionService<Conn extends RemoteDesktopConnection> {
  private readonly sessions = new Map<string, Session>()
  private readonly forwards: RemoteDesktopForwards<Conn>
  private readonly connect: (host: string, port: number) => Socket

  constructor(private readonly dependencies: RemoteDesktopSessionServiceDependencies<Conn>) {
    this.forwards = dependencies.forwards
    this.connect = dependencies.connect ?? ((host, port) => connectTcp({ host, port }))
  }

  async open(
    hostId: RemoteDesktopHostId,
    sink: RemoteDesktopSessionSink
  ): Promise<RemoteDesktopOpenResult> {
    const resolved = this.dependencies.resolveRoute(hostId)
    if (!resolved.ok) {
      return resolved
    }
    let host: string
    let port = REMOTE_DESKTOP_DEFAULT_VNC_PORT
    let targetId: string | null = null
    let forwardId: string | null = null
    if (resolved.route.kind === 'ssh') {
      targetId = resolved.route.targetId
      const conn = this.dependencies.getSshConnection(targetId)
      if (!conn || conn.isDisposed()) {
        return failure(
          'ssh_not_connected',
          'Connect to this SSH host first, then open its desktop.'
        )
      }
      try {
        const entry = await this.forwards.addForward(
          targetId,
          conn,
          0,
          '127.0.0.1',
          REMOTE_DESKTOP_DEFAULT_VNC_PORT,
          FORWARD_LABEL
        )
        forwardId = entry.id
        host = '127.0.0.1'
        port = entry.localPort
      } catch (error) {
        return failure('tunnel_failed', `Could not open the SSH tunnel: ${describe(error)}`)
      }
    } else {
      host = resolved.route.host
    }

    let socket: Socket
    try {
      socket = await this.connectSocket(host, port)
    } catch (error) {
      if (forwardId) {
        await this.forwards.removeForwardAndWait(forwardId).catch(() => undefined)
      }
      return failure(
        'vnc_unreachable',
        `Could not reach the screen sharing service (${describe(error)}). On a Mac, turn on Screen Sharing in System Settings > General > Sharing.`
      )
    }

    const session: Session = {
      id: randomUUID(),
      hostId,
      sink,
      socket,
      targetId,
      forwardId,
      closed: false
    }
    this.sessions.set(session.id, session)
    socket.setNoDelay(true)
    socket.on('data', (bytes: Buffer) => {
      if (!session.closed) {
        sink.data(bytes)
      }
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      void this.finish(session, {
        code: 'session_lost',
        message: 'The remote desktop connection closed.'
      })
    })
    return { ok: true, sessionId: session.id }
  }

  write(sessionId: string, bytes: Uint8Array): void {
    const session = this.sessions.get(sessionId)
    if (session && !session.closed) {
      session.socket.write(bytes)
    }
  }

  async credentialFor(sessionId: string): Promise<RemoteDesktopCredentialInput | null> {
    const session = this.sessions.get(sessionId)
    return session ? await this.dependencies.loadCredential(session.hostId) : null
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      await this.finish(session)
    }
  }

  async closeForTarget(targetId: string): Promise<void> {
    const owned = [...this.sessions.values()].filter((session) => session.targetId === targetId)
    await Promise.all([
      ...owned.map((session) =>
        this.finish(session, { code: 'session_lost', message: 'The SSH connection closed.' })
      ),
      this.forwards.removeAllForwards(targetId)
    ])
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.finish(session)))
    await this.forwards.closeAll()
  }

  private async finish(session: Session, error?: RemoteDesktopError): Promise<void> {
    if (session.closed) {
      return
    }
    session.closed = true
    this.sessions.delete(session.id)
    session.socket.destroy()
    session.sink.closed(error)
    if (session.forwardId) {
      await this.forwards.removeForwardAndWait(session.forwardId).catch(() => undefined)
    }
  }

  private connectSocket(host: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = this.connect(host, port)
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error('timed out'))
      }, CONNECT_TIMEOUT_MS)
      const onConnect = (): void => {
        cleanup()
        resolve(socket)
      }
      const onError = (error: Error): void => {
        cleanup()
        socket.destroy()
        reject(error)
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.off('connect', onConnect)
        socket.off('error', onError)
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
    })
  }
}

function failure(code: RemoteDesktopError['code'], message: string): RemoteDesktopOpenResult {
  return { ok: false, error: { code, message } }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
