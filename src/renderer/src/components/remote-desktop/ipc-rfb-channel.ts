import type { RfbRawChannel } from '@novnc/novnc'

export type IpcRfbTransport = {
  write: (bytes: ArrayBuffer) => void
  close: () => void
}

type MessageHandler = NonNullable<RfbRawChannel['onmessage']>

/** WebSocket-shaped channel noVNC attaches to; bytes travel over Topo IPC to a socket main owns. */
export class IpcRfbChannel implements RfbRawChannel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState: 'open' | 'closed' = 'open'
  onopen: RfbRawChannel['onopen'] = null
  onclose: RfbRawChannel['onclose'] = null
  onerror: RfbRawChannel['onerror'] = null
  private messageHandler: MessageHandler | null = null
  // The server greets as soon as the socket connects, before noVNC attaches its handler.
  private pending: ArrayBuffer[] = []

  constructor(private readonly transport: IpcRfbTransport) {}

  get onmessage(): MessageHandler | null {
    return this.messageHandler
  }

  set onmessage(handler: MessageHandler | null) {
    this.messageHandler = handler
    if (!handler || this.pending.length === 0) {
      return
    }
    const queued = this.pending
    this.pending = []
    for (const data of queued) {
      handler({ data })
    }
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== 'open') {
      return
    }
    // noVNC sends views into its reusable send queue; copy before the bytes cross IPC.
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const copy = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copy).set(bytes)
    this.transport.write(copy)
  }

  close(): void {
    if (this.readyState === 'closed') {
      return
    }
    this.readyState = 'closed'
    this.transport.close()
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }

  receive(data: ArrayBuffer): void {
    if (this.readyState !== 'open') {
      return
    }
    if (this.messageHandler) {
      this.messageHandler({ data })
    } else {
      this.pending.push(data)
    }
  }

  remoteClosed(reason: string): void {
    if (this.readyState === 'closed') {
      return
    }
    this.readyState = 'closed'
    this.pending = []
    this.onclose?.({ code: 1006, reason, wasClean: false })
  }
}
