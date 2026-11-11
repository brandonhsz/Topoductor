import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { shell } from 'electron'

export type LoopbackPkceAuthorization = {
  code: string
  codeVerifier: string
  redirectUri: string
  state: string
}

export type LoopbackPkceAuthorizationOptions = {
  /** Prefix for thrown error codes, e.g. `topo_cloud_auth` → `topo_cloud_auth_timeout`. */
  errorPrefix: string
  buildAuthorizeUrl: (args: { redirectUri: string; state: string; codeChallenge: string }) => URL
  successPage: string
  successHeaders: Readonly<Record<string, string>>
  onAuthorizeUrl?: (url: string) => void
  signal?: AbortSignal
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000

export function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function createCodeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function closeServer(server: Server): void {
  try {
    // Browser keep-alive sockets can delay close and timeout cleanup.
    server.closeAllConnections?.()
    server.close()
  } catch {
    // Already closed.
  }
}

/** OAuth authorization-code + PKCE through the system browser and a 127.0.0.1 callback. */
export function beginLoopbackPkceAuthorization(
  options: LoopbackPkceAuthorizationOptions
): Promise<LoopbackPkceAuthorization> {
  const { errorPrefix } = options
  const codeVerifier = base64Url(randomBytes(32))
  const state = base64Url(randomBytes(32))

  return new Promise((resolve, reject) => {
    let settled = false
    let redirectUri = ''

    function rejectFlow(error: Error): void {
      if (settled) {
        return
      }
      settled = true
      reject(error)
      closeServer(server)
    }

    function resolveFlow(code: string): void {
      if (settled) {
        return
      }
      settled = true
      resolve({ code, codeVerifier, redirectUri, state })
      closeServer(server)
    }

    function writeInvalidCallback(response: ServerResponse): void {
      response.writeHead(400)
      response.end('Invalid Topo sign-in response.')
    }

    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/auth/callback') {
          response.writeHead(404)
          response.end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        if (returnedState !== state) {
          // Stray loopback probes must not cancel the user’s login.
          writeInvalidCallback(response)
          return
        }
        if (url.searchParams.has('error')) {
          const cancelled = url.searchParams.get('error') === 'access_denied'
          response.writeHead(400)
          response.end(
            cancelled
              ? 'Topo sign-in was cancelled.'
              : 'Topo sign-in failed. Return to Topo and try again.'
          )
          rejectFlow(
            new Error(cancelled ? `${errorPrefix}_denied` : `${errorPrefix}_callback_failed`)
          )
          return
        }
        if (!code) {
          writeInvalidCallback(response)
          return
        }
        response.writeHead(200, options.successHeaders)
        response.end(options.successPage)
        resolveFlow(code)
      } catch (error) {
        rejectFlow(error instanceof Error ? error : new Error(`${errorPrefix}_callback_failed`))
      }
    })

    const timeout = setTimeout(() => {
      rejectFlow(new Error(`${errorPrefix}_timeout`))
    }, AUTH_TIMEOUT_MS)
    const cancel = (): void => rejectFlow(new Error(`${errorPrefix}_cancelled`))
    options.signal?.addEventListener('abort', cancel, { once: true })
    server.once('close', () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', cancel)
    })
    server.once('error', rejectFlow)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        rejectFlow(new Error(`${errorPrefix}_loopback_unavailable`))
        return
      }
      redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
      const authorizeUrl = options
        .buildAuthorizeUrl({ redirectUri, state, codeChallenge: createCodeChallenge(codeVerifier) })
        .toString()
      options.onAuthorizeUrl?.(authorizeUrl)
      void shell.openExternal(authorizeUrl).catch((error) => {
        rejectFlow(error instanceof Error ? error : new Error(`${errorPrefix}_browser_open_failed`))
      })
    })
  })
}
