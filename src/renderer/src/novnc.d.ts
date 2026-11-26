declare module '@novnc/novnc' {
  export type RfbCredentials = { username?: string; password?: string; target?: string }

  export type RfbRawChannel = {
    binaryType: string
    protocol: string
    readyState: string
    onopen: ((event: Event) => void) | null
    onmessage: ((event: { data: ArrayBuffer }) => void) | null
    onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null
    onerror: ((event: Event) => void) | null
    send: (data: ArrayBuffer | Uint8Array) => void
    close: () => void
  }

  export type RfbOptions = { shared?: boolean; credentials?: RfbCredentials }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | RfbRawChannel, options?: RfbOptions)
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    focusOnClick: boolean
    viewOnly: boolean
    qualityLevel: number
    compressionLevel: number
    background: string
    disconnect(): void
    sendCredentials(credentials: RfbCredentials): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void
    clipboardPasteFrom(text: string): void
  }
}
