import { ipcMain, type WebContents } from 'electron'
import { getAppEnvironment } from '../../shared/app-environment'
import { getSecretStore } from '../../shared/secret-store'
import { resolveEnvironment } from '../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  isRemoteDesktopHostId,
  type RemoteDesktopCredentialInput,
  type RemoteDesktopCredentialStatus,
  type RemoteDesktopHostId,
  type RemoteDesktopOpenResult,
  type RemoteDesktopSessionClosed,
  type RemoteDesktopSessionData
} from '../../shared/remote-desktop/remote-desktop-contract'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { SshPortForwardManager } from '../ssh/port-forwarding/ssh-port-forward'
import {
  RemoteDesktopCredentialStore,
  RemoteDesktopSecretStoreUnavailableError
} from '../remote-desktop/remote-desktop-credential-store'
import { resolveRemoteDesktopRoute } from '../remote-desktop/remote-desktop-route'
import { RemoteDesktopSessionService } from '../remote-desktop/remote-desktop-session-service'
import {
  closeAllRemoteDesktopWindows,
  createOrFocusRemoteDesktopWindow,
  remoteDesktopHostOfRenderer
} from '../window/remote-desktop-window'
import { abortWhenRendererGone } from './renderer-lifetime-abort'
import { isTrustedUIRenderer } from './ui'
import { onSshShutdown, onSshTargetTeardown } from './ssh/ssh-target-teardown-listeners'

const MAX_TITLE_LENGTH = 200

const credentials = new RemoteDesktopCredentialStore(getSecretStore)

const sessions = new RemoteDesktopSessionService({
  resolveRoute: (hostId) =>
    resolveRemoteDesktopRoute(hostId, {
      resolveRuntimeEnvironment: (environmentId) => {
        try {
          return resolveEnvironment(getAppEnvironment().getPath('userData'), environmentId)
        } catch {
          return null
        }
      }
    }),
  getSshConnection: (targetId) => getSshConnectionManager()?.getConnection(targetId),
  loadCredential: (hostId) => credentials.load(hostId),
  forwards: new SshPortForwardManager()
})

const sessionOwners = new Map<string, WebContents>()

function requireHostWindow(sender: WebContents, hostId: unknown): RemoteDesktopHostId {
  if (!isRemoteDesktopHostId(hostId) || remoteDesktopHostOfRenderer(sender) !== hostId) {
    throw new Error('Remote desktop request did not come from this host’s window.')
  }
  return hostId
}

function requireSessionOwner(sender: WebContents, sessionId: unknown): string | null {
  if (typeof sessionId !== 'string' || sessionOwners.get(sessionId) !== sender) {
    return null
  }
  return sessionId
}

function send(owner: WebContents, channel: string, payload: unknown): void {
  if (!owner.isDestroyed()) {
    owner.send(channel, payload)
  }
}

let registered = false

export function registerRemoteDesktopHandlers(): void {
  if (registered) {
    return
  }
  registered = true
  onSshTargetTeardown((targetId) => sessions.closeForTarget(targetId))
  onSshShutdown(shutdownRemoteDesktop)
  ipcMain.handle(
    'remoteDesktop:openWindow',
    (event, args: { hostId?: unknown; title?: unknown }) => {
      if (!isTrustedUIRenderer(event.sender) || !isRemoteDesktopHostId(args?.hostId)) {
        return
      }
      const title =
        typeof args.title === 'string' ? args.title.slice(0, MAX_TITLE_LENGTH) : 'Remote desktop'
      createOrFocusRemoteDesktopWindow(args.hostId, title)
    }
  )

  ipcMain.handle(
    'remoteDesktop:getCredentialStatus',
    (event, args: { hostId?: unknown }): Promise<RemoteDesktopCredentialStatus> =>
      credentials.status(requireHostWindow(event.sender, args?.hostId))
  )

  ipcMain.handle(
    'remoteDesktop:saveCredential',
    async (event, args: { hostId?: unknown; input?: RemoteDesktopCredentialInput }) => {
      const hostId = requireHostWindow(event.sender, args?.hostId)
      const input = args?.input
      if (!input || typeof input.password !== 'string') {
        throw new Error('Remote desktop credential is invalid')
      }
      try {
        return await credentials.save(hostId, {
          username: typeof input.username === 'string' ? input.username : null,
          password: input.password
        })
      } catch (error) {
        if (error instanceof RemoteDesktopSecretStoreUnavailableError) {
          throw new Error(`secret_store_unavailable: ${error.message}`)
        }
        throw error
      }
    }
  )

  ipcMain.handle('remoteDesktop:forgetCredential', async (event, args: { hostId?: unknown }) => {
    await credentials.forget(requireHostWindow(event.sender, args?.hostId))
  })

  ipcMain.handle(
    'remoteDesktop:openSession',
    async (event, args: { hostId?: unknown }): Promise<RemoteDesktopOpenResult> => {
      const hostId = requireHostWindow(event.sender, args?.hostId)
      const owner = event.sender
      const lifetime = abortWhenRendererGone(owner)
      let sessionId: string | null = null
      const result = await sessions.open(hostId, {
        data: (bytes) => {
          if (sessionId) {
            const copy = new ArrayBuffer(bytes.byteLength)
            new Uint8Array(copy).set(bytes)
            send(owner, 'remoteDesktop:data', {
              sessionId,
              bytes: copy
            } satisfies RemoteDesktopSessionData)
          }
        },
        closed: (error) => {
          lifetime.dispose()
          if (sessionId) {
            sessionOwners.delete(sessionId)
            send(owner, 'remoteDesktop:sessionClosed', {
              sessionId,
              ...(error ? { error } : {})
            } satisfies RemoteDesktopSessionClosed)
          }
        }
      })
      if (!result.ok) {
        lifetime.dispose()
        return result
      }
      sessionId = result.sessionId
      if (lifetime.signal.aborted) {
        await sessions.close(sessionId)
        return { ok: false, error: { code: 'session_lost', message: 'The window closed.' } }
      }
      sessionOwners.set(sessionId, owner)
      const opened = sessionId
      lifetime.signal.addEventListener('abort', () => void sessions.close(opened), { once: true })
      return result
    }
  )

  ipcMain.handle(
    'remoteDesktop:getSessionCredential',
    async (event, args: { sessionId?: unknown }): Promise<RemoteDesktopCredentialInput | null> => {
      const sessionId = requireSessionOwner(event.sender, args?.sessionId)
      return sessionId ? await sessions.credentialFor(sessionId) : null
    }
  )

  ipcMain.on('remoteDesktop:write', (event, args: { sessionId?: unknown; bytes?: unknown }) => {
    const sessionId = requireSessionOwner(event.sender, args?.sessionId)
    if (sessionId && args.bytes instanceof ArrayBuffer) {
      sessions.write(sessionId, new Uint8Array(args.bytes))
    }
  })

  ipcMain.handle('remoteDesktop:closeSession', async (event, args: { sessionId?: unknown }) => {
    const sessionId = requireSessionOwner(event.sender, args?.sessionId)
    if (sessionId) {
      await sessions.close(sessionId)
    }
  })
}

async function shutdownRemoteDesktop(): Promise<void> {
  closeAllRemoteDesktopWindows()
  await sessions.closeAll()
}
