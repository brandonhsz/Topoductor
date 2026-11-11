import type { PreloadApi } from '../../../../preload/api-types'
import { AVENAPM_DEFAULT_BASE_URL } from '../../../../shared/avenapm/avenapm-types'

// AvenaPM credentials live on the desktop host; the web client has no browser loopback to sign in with.
export function createWebAvenaPMApi(): PreloadApi['avenapm'] {
  const disconnected = { connected: false as const, baseUrl: AVENAPM_DEFAULT_BASE_URL }
  const message = 'AvenaPM is only available in the desktop app.'
  return {
    status: () => Promise.resolve(disconnected),
    connect: () => Promise.reject(new Error(message)),
    cancelConnect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(disconnected),
    listTasks: () => Promise.resolve({ ok: false, reason: 'not_connected', message })
  }
}
