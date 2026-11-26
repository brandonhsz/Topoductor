import { parseExecutionHostId, type ExecutionHostId } from '../execution-host'

export const REMOTE_DESKTOP_DEFAULT_VNC_PORT = 5900

export type RemoteDesktopHostId = Exclude<ExecutionHostId, 'local'>

/** Whether a stored credential exists; the secret itself never leaves main except for one live session. */
export type RemoteDesktopCredentialStatus =
  | { kind: 'none' }
  | { kind: 'saved'; username: string | null }

export type RemoteDesktopCredentialInput = { username: string | null; password: string }

export type RemoteDesktopErrorCode =
  | 'host_unsupported'
  | 'host_not_private'
  | 'ssh_not_connected'
  | 'tunnel_failed'
  | 'vnc_unreachable'
  | 'session_not_found'
  | 'secret_store_unavailable'
  | 'session_lost'

export type RemoteDesktopError = { code: RemoteDesktopErrorCode; message: string }

export type RemoteDesktopOpenResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: RemoteDesktopError }

export type RemoteDesktopSessionClosed = { sessionId: string; error?: RemoteDesktopError }

export type RemoteDesktopSessionData = { sessionId: string; bytes: ArrayBuffer }

export type RemoteDesktopApi = {
  openWindow: (hostId: RemoteDesktopHostId, title: string) => Promise<void>
  getCredentialStatus: (hostId: RemoteDesktopHostId) => Promise<RemoteDesktopCredentialStatus>
  saveCredential: (
    hostId: RemoteDesktopHostId,
    input: RemoteDesktopCredentialInput
  ) => Promise<RemoteDesktopCredentialStatus>
  forgetCredential: (hostId: RemoteDesktopHostId) => Promise<void>
  openSession: (hostId: RemoteDesktopHostId) => Promise<RemoteDesktopOpenResult>
  /** Saved credential for a live session; null when none is stored. */
  getSessionCredential: (sessionId: string) => Promise<RemoteDesktopCredentialInput | null>
  write: (sessionId: string, bytes: ArrayBuffer) => void
  closeSession: (sessionId: string) => Promise<void>
  onData: (callback: (data: RemoteDesktopSessionData) => void) => () => void
  onSessionClosed: (callback: (data: RemoteDesktopSessionClosed) => void) => () => void
}

export function isRemoteDesktopHostId(value: unknown): value is RemoteDesktopHostId {
  if (typeof value !== 'string') {
    return false
  }
  const kind = parseExecutionHostId(value)?.kind
  return kind === 'ssh' || kind === 'runtime'
}
