import type { PreloadApi } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'

// MCP secrets are encrypted by the desktop's OS keychain, which the web client cannot reach.
export function createWebTopoMcpApi(): PreloadApi['topoMcp'] {
  return {
    secretStatus: () => Promise.resolve({}),
    setSecret: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'components.settings.mcp.webSecretUnavailable',
          'Secret values can only be saved in the desktop app.'
        )
      }),
    deleteSecret: () => Promise.resolve()
  }
}
