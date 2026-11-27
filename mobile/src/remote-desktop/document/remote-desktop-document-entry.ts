import RFB, { type RfbRawChannel } from '@novnc/novnc'
import type {
  RemoteDesktopDocumentCommand,
  RemoteDesktopDocumentEvent,
  RemoteDesktopSpecialKey
} from '../remote-desktop-webview-protocol'

// Runs inside the native WebView: noVNC draws here; bytes and credentials travel through native.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }
}

const SEND_FLUSH_MS = 8
const XK = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  Delete: 0xffff
} as const

function post(event: RemoteDesktopDocumentEvent): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(event))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

function fromBase64(data: string): ArrayBuffer {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

/** WebSocket-shaped channel noVNC attaches to; sends coalesce briefly so mouse drags cost fewer round trips. */
class NativeRfbChannel implements RfbRawChannel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState: 'open' | 'closed' = 'open'
  onopen: RfbRawChannel['onopen'] = null
  onclose: RfbRawChannel['onclose'] = null
  onerror: RfbRawChannel['onerror'] = null
  private handler: RfbRawChannel['onmessage'] = null
  // The server greets before noVNC attaches its handler.
  private pending: ArrayBuffer[] = []
  private outgoing: Uint8Array[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  get onmessage(): RfbRawChannel['onmessage'] {
    return this.handler
  }

  set onmessage(handler: RfbRawChannel['onmessage']) {
    this.handler = handler
    const queued = this.pending
    this.pending = []
    for (const data of queued) {
      handler?.({ data })
    }
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== 'open') {
      return
    }
    // noVNC reuses its send buffer; copy before queuing.
    this.outgoing.push(new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)))
    this.flushTimer ??= setTimeout(() => this.flush(), SEND_FLUSH_MS)
  }

  close(): void {
    this.flush()
    this.finish(1000, '', true)
  }

  receive(data: ArrayBuffer): void {
    if (this.readyState !== 'open') {
      return
    }
    if (this.handler) {
      this.handler({ data })
    } else {
      this.pending.push(data)
    }
  }

  remoteClosed(reason: string): void {
    this.finish(1006, reason, false)
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.outgoing.length === 0) {
      return
    }
    const total = this.outgoing.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.outgoing) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.outgoing = []
    post({ type: 'send', data: toBase64(merged) })
  }

  private finish(code: number, reason: string, wasClean: boolean): void {
    if (this.readyState === 'closed') {
      return
    }
    this.readyState = 'closed'
    this.pending = []
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.outgoing = []
    this.onclose?.({ code, reason, wasClean })
  }
}

type Live = { rfb: RFB; channel: NativeRfbChannel; securityFailure: string | null }
let live: Live | null = null

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id)
  if (!(element instanceof type)) {
    throw new Error(`Remote desktop document is missing #${id}`)
  }
  return element
}

const screen = requireElement('screen', HTMLDivElement)
const keyboard = requireElement('keyboard', HTMLTextAreaElement)

function eventDetail(event: Event): object | null {
  if (!(event instanceof CustomEvent)) {
    return null
  }
  const detail: unknown = event.detail
  return typeof detail === 'object' && detail !== null ? detail : null
}

function start(): void {
  stop()
  const channel = new NativeRfbChannel()
  const rfb = new RFB(screen, channel, { shared: true })
  rfb.scaleViewport = true
  rfb.resizeSession = false
  rfb.focusOnClick = false
  rfb.background = 'transparent'
  rfb.qualityLevel = 6
  rfb.compressionLevel = 6
  const session: Live = { rfb, channel, securityFailure: null }
  live = session
  rfb.addEventListener('credentialsrequired', (event) => {
    const detail = eventDetail(event)
    const types = detail && 'types' in detail ? detail.types : undefined
    post({
      type: 'credentialsRequired',
      needsUsername: Array.isArray(types) && types.includes('username')
    })
  })
  rfb.addEventListener('securityfailure', (event) => {
    const detail = eventDetail(event)
    const reason = detail && 'reason' in detail ? detail.reason : undefined
    session.securityFailure =
      typeof reason === 'string' && reason ? reason : 'Authentication failed'
  })
  rfb.addEventListener('connect', () => {
    if (live === session) {
      post({ type: 'connected' })
    }
  })
  rfb.addEventListener('disconnect', () => {
    if (live !== session) {
      return
    }
    live = null
    post({
      type: 'disconnected',
      ...(session.securityFailure ? { securityFailure: session.securityFailure } : {})
    })
  })
}

function stop(): void {
  const session = live
  live = null
  session?.rfb.disconnect()
}

function tapKey(keysym: number): void {
  live?.rfb.sendKey(keysym, null, true)
  live?.rfb.sendKey(keysym, null, false)
}

function charKeysym(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (character === '\n') {
    return XK.Return
  }
  // Latin-1 keysyms equal their code point; the rest use X11's Unicode keysym range.
  return codePoint < 0x100 ? codePoint : 0x01000000 | codePoint
}

function sendSpecialKey(key: RemoteDesktopSpecialKey): void {
  switch (key) {
    case 'escape':
      tapKey(XK.Escape)
      return
    case 'tab':
      tapKey(XK.Tab)
      return
    case 'left':
      tapKey(XK.Left)
      return
    case 'up':
      tapKey(XK.Up)
      return
    case 'right':
      tapKey(XK.Right)
      return
    case 'down':
      tapKey(XK.Down)
  }
}

// Soft keyboards report text through input events; keydown codes are unreliable on phones.
keyboard.addEventListener('beforeinput', (event) => {
  event.preventDefault()
  if (event.inputType === 'deleteContentBackward') {
    tapKey(XK.BackSpace)
  } else if (event.inputType === 'deleteContentForward') {
    tapKey(XK.Delete)
  } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    tapKey(XK.Return)
  } else if (event.data) {
    for (const character of event.data) {
      tapKey(charKeysym(character))
    }
  }
})

function handle(command: RemoteDesktopDocumentCommand): void {
  switch (command.type) {
    case 'start':
      start()
      return
    case 'data':
      live?.channel.receive(fromBase64(command.data))
      return
    case 'remoteClosed':
      live?.channel.remoteClosed(command.reason)
      return
    case 'credentials':
      live?.rfb.sendCredentials({ username: command.username, password: command.password })
      return
    case 'focusKeyboard':
      if (document.activeElement === keyboard) {
        keyboard.blur()
      } else {
        keyboard.focus()
      }
      return
    case 'key':
      sendSpecialKey(command.key)
      return
    case 'stop':
      stop()
  }
}

function onNativeMessage(event: Event): void {
  const raw: unknown = event instanceof MessageEvent ? event.data : null
  if (typeof raw !== 'string') {
    return
  }
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: native is this document's only sender and posts only RemoteDesktopDocumentCommand.
    handle(JSON.parse(raw) as RemoteDesktopDocumentCommand)
  } catch (error) {
    post({ type: 'engineError', message: error instanceof Error ? error.message : String(error) })
  }
}

// iOS delivers native messages on window, Android on document.
window.addEventListener('message', onNativeMessage)
document.addEventListener('message', onNativeMessage)
window.addEventListener('error', (event) => post({ type: 'engineError', message: event.message }))
post({ type: 'loaded' })
