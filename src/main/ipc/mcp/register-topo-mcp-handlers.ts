import { ipcMain } from 'electron'
import {
  deleteTopoMcpSecret,
  hasTopoMcpSecret,
  writeTopoMcpSecret
} from '../../mcp/topo-mcp-secret-vault'
import type { TopoMcpSecretWriteResult } from '../../../shared/mcp/topo-mcp-secret-api'

const SECRET_KEY = /^[^\s:]{1,256}:(env|headers):[A-Za-z_][A-Za-z0-9_-]{0,127}$/
const MAX_SECRET_LENGTH = 16 * 1024

function secretKey(value: unknown): string | null {
  return typeof value === 'string' && SECRET_KEY.test(value) ? value : null
}

/** The renderer may write, delete and ask which secrets exist; values never travel back to it. */
export function registerTopoMcpHandlers(): void {
  ipcMain.handle(
    'topoMcp:secretStatus',
    async (_event, keys: unknown): Promise<Record<string, boolean>> => {
      const status: Record<string, boolean> = {}
      for (const raw of Array.isArray(keys) ? keys.slice(0, 512) : []) {
        const key = secretKey(raw)
        if (key) {
          status[key] = await hasTopoMcpSecret(key)
        }
      }
      return status
    }
  )
  ipcMain.handle(
    'topoMcp:setSecret',
    async (_event, rawKey: unknown, value: unknown): Promise<TopoMcpSecretWriteResult> => {
      const key = secretKey(rawKey)
      if (!key || typeof value !== 'string' || !value || value.length > MAX_SECRET_LENGTH) {
        return { ok: false, error: 'invalid secret' }
      }
      const result = await writeTopoMcpSecret(key, value)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    }
  )
  ipcMain.handle('topoMcp:deleteSecret', async (_event, rawKey: unknown): Promise<void> => {
    const key = secretKey(rawKey)
    if (key) {
      await deleteTopoMcpSecret(key)
    }
  })
}
