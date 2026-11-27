import { describe, expect, it, vi } from 'vitest'
import {
  RemoteDesktopSessionController,
  type RemoteDesktopViewState
} from './remote-desktop-session-controller'
import type { RemoteDesktopDocumentCommand } from './remote-desktop-webview-protocol'
import type { RpcResponse } from '../transport/rpc/rpc-wire-types'

function setup(saved: { username: string; password: string } | null = null) {
  let listener: ((payload: unknown) => void) | null = null
  const unsubscribe = vi.fn()
  const writes: unknown[] = []
  let releaseWrite: (() => void) | null = null
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, onData: (payload: unknown) => void) => {
      listener = onData
      return unsubscribe
    }),
    sendRequest: vi.fn((_method: string, params?: unknown) => {
      writes.push(params)
      return new Promise<RpcResponse>((resolve) => {
        releaseWrite = () => resolve({ id: 'write', ok: true, result: { written: true } })
      })
    })
  }
  const posted: RemoteDesktopDocumentCommand[] = []
  const states: RemoteDesktopViewState[] = []
  const saveCredential = vi.fn(async () => undefined)
  const controller = new RemoteDesktopSessionController({
    client,
    post: (command) => posted.push(command),
    loadCredential: async () => saved,
    saveCredential,
    onState: (state) => states.push(state)
  })
  controller.start()
  return {
    controller,
    client,
    unsubscribe,
    writes,
    posted,
    states,
    saveCredential,
    emit: (payload: unknown) => listener?.(payload),
    finishWrite: () => releaseWrite?.()
  }
}

describe('RemoteDesktopSessionController', () => {
  it('starts the viewer, then forwards host bytes into it', () => {
    const { client, posted, emit } = setup()
    expect(client.subscribe).toHaveBeenCalledWith('remoteDesktop.stream', {}, expect.any(Function))
    emit({ type: 'ready', subscriptionId: 'sub-1' })
    emit({ type: 'data', data: 'UkZC' })
    expect(posted).toEqual([{ type: 'start' }, { type: 'data', data: 'UkZC' }])
  })

  it('sends viewer bytes one write at a time, in order, once the stream is ready', async () => {
    const { controller, writes, emit, finishWrite } = setup()
    controller.handleDocumentEvent({ type: 'send', data: 'AQ==' })
    controller.handleDocumentEvent({ type: 'send', data: 'Ag==' })
    expect(writes).toEqual([])

    emit({ type: 'ready', subscriptionId: 'sub-1' })
    expect(writes).toEqual([{ subscriptionId: 'sub-1', data: 'AQ==' }])
    finishWrite()
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1]).toEqual({ subscriptionId: 'sub-1', data: 'Ag==' })
  })

  it('answers the server with a saved credential, and asks again after a rejection', async () => {
    const { controller, posted, states } = setup({ username: 'admin', password: 'pw' })
    controller.handleDocumentEvent({ type: 'credentialsRequired', needsUsername: true })
    await vi.waitFor(() =>
      expect(posted).toContainEqual({ type: 'credentials', username: 'admin', password: 'pw' })
    )

    controller.handleDocumentEvent({ type: 'disconnected', securityFailure: 'Bad password' })
    expect(states.at(-1)).toEqual({
      phase: 'credentials',
      needsUsername: true,
      error: 'Bad password'
    })
  })

  it('prompts when nothing is saved and remembers what the user enters', async () => {
    const { controller, posted, states, saveCredential } = setup()
    controller.handleDocumentEvent({ type: 'credentialsRequired', needsUsername: false })
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ phase: 'credentials', needsUsername: false })
    )

    await controller.submitCredentials({ username: '', password: 'secret' }, true)
    expect(saveCredential).toHaveBeenCalledWith({ username: '', password: 'secret' })
    expect(posted.at(-1)).toEqual({ type: 'credentials', username: '', password: 'secret' })
    expect(states.at(-1)).toEqual({ phase: 'connecting' })
  })

  it('restarts the viewer when a reconnect replays the stream as a new session', () => {
    const { posted, emit } = setup()
    emit({ type: 'ready', subscriptionId: 'sub-1' })
    emit({ type: 'ready', subscriptionId: 'sub-2' })
    expect(posted.filter((command) => command.type === 'start')).toHaveLength(2)
  })

  it('shows the host’s reason when its VNC server cannot be reached', () => {
    const { posted, states, emit } = setup()
    emit({ type: 'closed', error: { code: 'vnc_unreachable', message: 'Turn on Screen Sharing' } })
    expect(states.at(-1)).toEqual({ phase: 'error', message: 'Turn on Screen Sharing' })
    expect(posted.at(-1)).toEqual({ type: 'remoteClosed', reason: 'Turn on Screen Sharing' })
  })

  it('asks for a Topo update when the host does not know the method', () => {
    const { states, emit } = setup()
    emit({ type: 'error', message: 'Method not found', error: { code: 'method_not_found' } })
    expect(states.at(-1)).toEqual({ phase: 'error', message: expect.stringMatching(/Update Topo/) })
  })

  it('releases the stream and stops the viewer on dispose', () => {
    const { controller, unsubscribe, posted } = setup()
    controller.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(posted.at(-1)).toEqual({ type: 'stop' })
  })
})
