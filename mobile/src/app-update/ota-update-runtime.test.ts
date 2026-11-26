import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = {
  checkForUpdate: vi.fn(),
  reload: vi.fn(async () => {})
}
let configured = true

vi.mock('./hot-updater-client', () => ({
  get hotUpdater() {
    return configured ? client : null
  }
}))

async function loadRuntime() {
  vi.resetModules()
  return import('./ota-update-runtime')
}

describe('checkForOtaUpdate', () => {
  beforeEach(() => {
    configured = true
    client.checkForUpdate.mockReset()
    client.reload.mockClear()
  })

  it('reports up-to-date when the server has nothing newer', async () => {
    client.checkForUpdate.mockResolvedValue(null)
    const { checkForOtaUpdate } = await loadRuntime()
    await expect(checkForOtaUpdate()).resolves.toBe('up-to-date')
    expect(client.checkForUpdate).toHaveBeenCalledWith({ updateStrategy: 'appVersion' })
  })

  it('downloads a newer bundle and stays ready without checking again', async () => {
    const updateBundle = vi.fn(async () => true)
    client.checkForUpdate.mockResolvedValue({ message: 'Rebrand', updateBundle })
    const { checkForOtaUpdate } = await loadRuntime()
    await expect(checkForOtaUpdate()).resolves.toBe('ready')
    await expect(checkForOtaUpdate()).resolves.toBe('ready')
    expect(updateBundle).toHaveBeenCalledOnce()
    expect(client.checkForUpdate).toHaveBeenCalledOnce()
  })

  it('joins a check already in flight', async () => {
    client.checkForUpdate.mockResolvedValue(null)
    const { checkForOtaUpdate } = await loadRuntime()
    await Promise.all([checkForOtaUpdate(), checkForOtaUpdate()])
    expect(client.checkForUpdate).toHaveBeenCalledOnce()
  })

  it('fails when the download fails or the server errors', async () => {
    client.checkForUpdate.mockResolvedValueOnce({
      message: null,
      updateBundle: vi.fn(async () => false)
    })
    const runtime = await loadRuntime()
    await expect(runtime.checkForOtaUpdate()).resolves.toBe('failed')
    client.checkForUpdate.mockRejectedValueOnce(new Error('offline'))
    await expect(runtime.checkForOtaUpdate()).resolves.toBe('failed')
  })

  it('treats a build without OTA config as up to date', async () => {
    configured = false
    const { checkForOtaUpdate } = await loadRuntime()
    await expect(checkForOtaUpdate()).resolves.toBe('up-to-date')
    expect(client.checkForUpdate).not.toHaveBeenCalled()
  })

  it('reloads into the downloaded bundle', async () => {
    const { applyOtaUpdate } = await loadRuntime()
    applyOtaUpdate()
    expect(client.reload).toHaveBeenCalledOnce()
  })
})
