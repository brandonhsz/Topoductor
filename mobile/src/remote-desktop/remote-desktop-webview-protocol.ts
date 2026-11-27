import * as z from 'zod'

/** Native → document. `data` fields carry base64 RFB bytes. */
export type RemoteDesktopDocumentCommand =
  | { type: 'start' }
  | { type: 'data'; data: string }
  | { type: 'remoteClosed'; reason: string }
  | { type: 'credentials'; username: string; password: string }
  | { type: 'focusKeyboard' }
  | { type: 'key'; key: RemoteDesktopSpecialKey }
  | { type: 'stop' }

export const REMOTE_DESKTOP_SPECIAL_KEYS = ['escape', 'tab', 'left', 'up', 'down', 'right'] as const
export type RemoteDesktopSpecialKey = (typeof REMOTE_DESKTOP_SPECIAL_KEYS)[number]

/** Document → native. */
export const RemoteDesktopDocumentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('loaded') }),
  z.object({ type: z.literal('send'), data: z.string().min(1) }),
  z.object({ type: z.literal('credentialsRequired'), needsUsername: z.boolean() }),
  z.object({ type: z.literal('connected') }),
  z.object({ type: z.literal('disconnected'), securityFailure: z.string().optional() }),
  z.object({ type: z.literal('engineError'), message: z.string() })
])
export type RemoteDesktopDocumentEvent = z.infer<typeof RemoteDesktopDocumentEventSchema>

export function parseRemoteDesktopDocumentEvent(raw: string): RemoteDesktopDocumentEvent | null {
  try {
    const parsed = RemoteDesktopDocumentEventSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Frames `remoteDesktop.stream` emits; mirrors RemoteDesktopStreamEvent on the host. */
export const RemoteDesktopStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), subscriptionId: z.string().min(1) }),
  z.object({ type: z.literal('data'), data: z.string() }),
  z.object({
    type: z.literal('closed'),
    error: z.object({ code: z.string(), message: z.string() }).optional()
  }),
  z.object({ type: z.literal('end') }),
  // The client's own frame when the host refuses or drops the request.
  z.object({
    type: z.literal('error'),
    message: z.string(),
    error: z.object({ code: z.string().optional() }).optional()
  })
])
export type RemoteDesktopStreamEvent = z.infer<typeof RemoteDesktopStreamEventSchema>
