import { useCallback, useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import type {
  RemoteDesktopCredentialInput,
  RemoteDesktopError,
  RemoteDesktopHostId
} from '../../../../shared/remote-desktop/remote-desktop-contract'
import { translate } from '@/i18n/i18n'
import { IpcRfbChannel } from './ipc-rfb-channel'

export type RemoteDesktopCredentialPrompt = {
  needsUsername: boolean
  reason: 'missing' | 'rejected'
}

export type RemoteDesktopViewState =
  | { phase: 'connecting' }
  | { phase: 'credentials'; prompt: RemoteDesktopCredentialPrompt; error?: string }
  | { phase: 'connected' }
  | { phase: 'error'; error: RemoteDesktopError | { code: 'vnc'; message: string } }

type LiveSession = {
  sessionId: string
  rfb: RFB
  channel: IpcRfbChannel
  dispose: () => void
  userClosed: boolean
  securityFailed: string | null
  awaitingCredentials: boolean
  needsUsername: boolean
  triedSaved: boolean
}

export function useRemoteDesktopSession(
  hostId: RemoteDesktopHostId,
  screen: React.RefObject<HTMLDivElement | null>
): {
  state: RemoteDesktopViewState
  reconnect: () => void
  submitCredentials: (input: RemoteDesktopCredentialInput) => Promise<void>
  sendCtrlAltDel: () => void
} {
  const [state, setState] = useState<RemoteDesktopViewState>({ phase: 'connecting' })
  const live = useRef<LiveSession | null>(null)
  const generation = useRef(0)

  const teardown = useCallback(() => {
    const session = live.current
    live.current = null
    if (!session) {
      return
    }
    session.userClosed = true
    session.dispose()
    session.rfb.disconnect()
    void window.api.remoteDesktop.closeSession(session.sessionId)
  }, [])

  const connect = useCallback(async () => {
    teardown()
    const attempt = ++generation.current
    setState({ phase: 'connecting' })
    const api = window.api.remoteDesktop
    const result = await api.openSession(hostId)
    if (attempt !== generation.current) {
      if (result.ok) {
        void api.closeSession(result.sessionId)
      }
      return
    }
    if (!result.ok) {
      setState({ phase: 'error', error: result.error })
      return
    }
    const target = screen.current
    if (!target) {
      void api.closeSession(result.sessionId)
      return
    }
    const { sessionId } = result
    const channel = new IpcRfbChannel({
      write: (bytes) => api.write(sessionId, bytes),
      close: () => void api.closeSession(sessionId)
    })
    const offData = api.onData((data) => {
      if (data.sessionId === sessionId) {
        channel.receive(data.bytes)
      }
    })
    const offClosed = api.onSessionClosed((data) => {
      if (data.sessionId === sessionId) {
        channel.remoteClosed(data.error?.message ?? 'closed')
      }
    })
    const rfb = new RFB(target, channel, { shared: true })
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.focusOnClick = true
    rfb.background = 'transparent'
    rfb.showDotCursor = true
    const listeners = new AbortController()
    const session: LiveSession = {
      sessionId,
      rfb,
      channel,
      dispose: () => {
        listeners.abort()
        offData()
        offClosed()
      },
      userClosed: false,
      securityFailed: null,
      awaitingCredentials: false,
      needsUsername: false,
      triedSaved: false
    }
    live.current = session

    const { signal } = listeners
    // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- session.dispose() aborts signal; teardown() runs it on unmount.
    rfb.addEventListener(
      'credentialsrequired',
      (event) => {
        const types = eventDetail(event)?.types
        session.needsUsername = Array.isArray(types) && types.includes('username')
        void (async () => {
          const saved = session.triedSaved ? null : await api.getSessionCredential(sessionId)
          if (live.current !== session) {
            return
          }
          if (saved) {
            session.triedSaved = true
            rfb.sendCredentials({ username: saved.username ?? '', password: saved.password })
            return
          }
          session.awaitingCredentials = true
          setState({
            phase: 'credentials',
            prompt: { needsUsername: session.needsUsername, reason: 'missing' }
          })
        })()
      },
      { signal }
    )
    rfb.addEventListener(
      'securityfailure',
      (event) => {
        const reason = eventDetail(event)?.reason
        session.securityFailed =
          typeof reason === 'string' && reason ? reason : 'Authentication failed'
      },
      { signal }
    )
    rfb.addEventListener(
      'connect',
      () => {
        if (live.current === session) {
          setState({ phase: 'connected' })
          rfb.focus()
        }
      },
      { signal }
    )
    rfb.addEventListener(
      'disconnect',
      () => {
        session.dispose()
        if (session.userClosed || live.current !== session) {
          return
        }
        live.current = null
        void api.closeSession(sessionId)
        if (session.securityFailed) {
          setState({
            phase: 'credentials',
            prompt: {
              needsUsername: session.needsUsername || session.triedSaved,
              reason: 'rejected'
            },
            error: session.securityFailed
          })
          return
        }
        setState({
          phase: 'error',
          error: {
            code: 'session_lost',
            message: translate('remoteDesktop.sessionLost', 'The remote desktop connection closed.')
          }
        })
      },
      { signal }
    )
  }, [hostId, screen, teardown])

  const submitCredentials = useCallback(
    async (input: RemoteDesktopCredentialInput) => {
      await window.api.remoteDesktop.saveCredential(hostId, input)
      const session = live.current
      if (session?.awaitingCredentials) {
        session.awaitingCredentials = false
        session.triedSaved = true
        setState({ phase: 'connecting' })
        session.rfb.sendCredentials({ username: input.username ?? '', password: input.password })
        return
      }
      await connect()
    },
    [connect, hostId]
  )

  useEffect(() => {
    void connect()
    return () => {
      generation.current += 1
      teardown()
    }
  }, [connect, teardown])

  return {
    state,
    reconnect: () => void connect(),
    submitCredentials,
    sendCtrlAltDel: () => live.current?.rfb.sendCtrlAltDel()
  }
}

function eventDetail(event: Event): Record<string, unknown> | null {
  if (!(event instanceof CustomEvent)) {
    return null
  }
  const detail: unknown = event.detail
  return typeof detail === 'object' && detail !== null ? { ...detail } : null
}
