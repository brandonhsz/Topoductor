import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { translate } from '../i18n/mobile-i18n'
import type { RemoteDesktopCredential } from './remote-desktop-credential-store'
import { remoteDesktopWriteRun } from './remote-desktop-write-operation'
import {
  RemoteDesktopStreamEventSchema,
  type RemoteDesktopDocumentCommand,
  type RemoteDesktopDocumentEvent
} from './remote-desktop-webview-protocol'

export type RemoteDesktopViewState =
  | { phase: 'connecting' }
  | { phase: 'credentials'; needsUsername: boolean; error?: string }
  | { phase: 'connected' }
  | { phase: 'error'; message: string }

export type RemoteDesktopSessionDependencies = {
  client: Pick<RpcClient, 'subscribe' | 'sendRequest'>
  post: (command: RemoteDesktopDocumentCommand) => void
  loadCredential: () => Promise<RemoteDesktopCredential | null>
  saveCredential: (credential: RemoteDesktopCredential) => Promise<void>
  onState: (state: RemoteDesktopViewState) => void
}

/** Joins the noVNC document to the host's VNC stream; one instance per connection attempt. */
export class RemoteDesktopSessionController {
  private unsubscribe: (() => void) | null = null
  private subscriptionId: string | null = null
  private outgoing: string[] = []
  private writing = false
  private disposed = false
  private triedSaved = false
  private awaitingCredentials = false
  private needsUsername = false
  private state: RemoteDesktopViewState = { phase: 'connecting' }

  constructor(private readonly dependencies: RemoteDesktopSessionDependencies) {}

  start(): void {
    this.setState({ phase: 'connecting' })
    this.dependencies.post({ type: 'start' })
    this.unsubscribe = this.dependencies.client.subscribe('remoteDesktop.stream', {}, (payload) =>
      this.handleStreamEvent(payload)
    )
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.dependencies.post({ type: 'stop' })
  }

  handleDocumentEvent(event: RemoteDesktopDocumentEvent): void {
    if (this.disposed) {
      return
    }
    switch (event.type) {
      case 'send':
        this.outgoing.push(event.data)
        void this.pumpWrites()
        return
      case 'credentialsRequired':
        this.needsUsername = event.needsUsername
        void this.provideCredentials()
        return
      case 'connected':
        this.setState({ phase: 'connected' })
        return
      case 'disconnected':
        this.handleDisconnected(event.securityFailure)
        return
      case 'engineError':
        this.setState({ phase: 'error', message: event.message })
        return
      case 'loaded':
    }
  }

  async submitCredentials(credential: RemoteDesktopCredential, remember: boolean): Promise<void> {
    if (remember) {
      await this.dependencies.saveCredential(credential).catch(() => undefined)
    }
    if (this.disposed || !this.awaitingCredentials) {
      return
    }
    this.awaitingCredentials = false
    this.setState({ phase: 'connecting' })
    this.dependencies.post({ type: 'credentials', ...credential })
  }

  private handleStreamEvent(payload: unknown): void {
    const parsed = RemoteDesktopStreamEventSchema.safeParse(payload)
    if (this.disposed || !parsed.success) {
      return
    }
    const event = parsed.data
    switch (event.type) {
      case 'ready':
        // A replayed stream after a reconnect is a fresh VNC connection; the viewer must restart with it.
        if (this.subscriptionId !== null && this.subscriptionId !== event.subscriptionId) {
          this.outgoing = []
          this.triedSaved = false
          this.setState({ phase: 'connecting' })
          this.dependencies.post({ type: 'start' })
        }
        this.subscriptionId = event.subscriptionId
        void this.pumpWrites()
        return
      case 'data':
        this.dependencies.post({ type: 'data', data: event.data })
        return
      case 'closed':
        if (event.error?.code === 'vnc_unreachable') {
          this.setState({ phase: 'error', message: event.error.message })
        }
        this.dependencies.post({
          type: 'remoteClosed',
          reason: event.error?.message ?? 'closed'
        })
        return
      case 'error':
        this.dependencies.post({ type: 'remoteClosed', reason: event.message })
        this.setState({ phase: 'error', message: describeStreamRefusal(event) })
        return
      case 'end':
    }
  }

  private handleDisconnected(securityFailure: string | undefined): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (securityFailure) {
      this.setState({
        phase: 'credentials',
        needsUsername: this.needsUsername || this.triedSaved,
        error: securityFailure
      })
      return
    }
    if (this.state.phase !== 'error') {
      this.setState({
        phase: 'error',
        message: translate('remoteDesktop.sessionLost', 'The remote desktop connection closed.')
      })
    }
  }

  private async provideCredentials(): Promise<void> {
    const saved = this.triedSaved ? null : await this.dependencies.loadCredential()
    if (this.disposed) {
      return
    }
    if (saved) {
      this.triedSaved = true
      this.dependencies.post({ type: 'credentials', ...saved })
      return
    }
    this.awaitingCredentials = true
    this.setState({ phase: 'credentials', needsUsername: this.needsUsername })
  }

  // One write in flight keeps keystrokes in order across the host's request handling.
  private async pumpWrites(): Promise<void> {
    if (this.writing || !this.subscriptionId) {
      return
    }
    this.writing = true
    try {
      while (!this.disposed && this.subscriptionId && this.outgoing.length > 0) {
        const data = this.outgoing.shift()
        if (data) {
          await remoteDesktopWriteRun
            .request(this.dependencies.client, { subscriptionId: this.subscriptionId, data })
            .catch(() => undefined)
        }
      }
    } finally {
      this.writing = false
    }
  }

  private setState(state: RemoteDesktopViewState): void {
    this.state = state
    this.dependencies.onState(state)
  }
}

function describeStreamRefusal(event: { message: string; error?: { code?: string } }): string {
  // Hosts older than this feature either lack the method or keep it off the phone allowlist.
  if (event.error?.code === 'method_not_found' || /not available to mobile/i.test(event.message)) {
    return translate(
      'remoteDesktop.hostTooOld',
      'Update Topo on this computer to open its remote desktop from your phone.'
    )
  }
  return event.message
}
