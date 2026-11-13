export type TopoMcpSecretWriteResult = { ok: true } | { ok: false; error: string }

/** Write-only access to MCP secret values; the renderer can only learn whether one is stored. */
export type TopoMcpApi = {
  secretStatus: (keys: string[]) => Promise<Record<string, boolean>>
  setSecret: (key: string, value: string) => Promise<TopoMcpSecretWriteResult>
  deleteSecret: (key: string) => Promise<void>
}
