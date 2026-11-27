import { z } from 'zod'
import { REMOTE_DESKTOP_DEFAULT_VNC_PORT } from '../remote-desktop/remote-desktop-contract'

// VNC display :N listens on 5900+N; nothing else on loopback is reachable through this stream.
export const REMOTE_DESKTOP_MAX_VNC_PORT = REMOTE_DESKTOP_DEFAULT_VNC_PORT + 99

// One noVNC send flush; framebuffer bytes only ever flow host to client.
export const REMOTE_DESKTOP_MAX_WRITE_BASE64_CHARS = 1024 * 1024

export const RemoteDesktopStreamParams = z
  .object({
    port: z
      .number()
      .int()
      .min(REMOTE_DESKTOP_DEFAULT_VNC_PORT)
      .max(REMOTE_DESKTOP_MAX_VNC_PORT)
      .optional()
  })
  .optional()

export const RemoteDesktopWriteParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id'),
  data: z.string().min(1).max(REMOTE_DESKTOP_MAX_WRITE_BASE64_CHARS)
})

export const RemoteDesktopCloseParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id')
})

/** Frames `remoteDesktop.stream` emits; `data` carries base64 RFB bytes. */
export type RemoteDesktopStreamEvent =
  | { type: 'ready'; subscriptionId: string }
  | { type: 'data'; data: string }
  | { type: 'closed'; error?: { code: 'vnc_unreachable' | 'session_lost'; message: string } }
