import { describe, expect, it, vi } from 'vitest'
import { requestDockAttention, type DockAttentionDeps } from './dock-attention'

function makeWindow(focused: boolean) {
  return { isFocused: vi.fn(() => focused), flashFrame: vi.fn() }
}

function makeDock() {
  return { bounce: vi.fn(() => 1) }
}

function run(overrides: Partial<DockAttentionDeps>) {
  const window = makeWindow(false)
  const dock = makeDock()
  const deps = { platform: 'darwin', window, dock, ...overrides } as DockAttentionDeps
  return { result: requestDockAttention(deps), window, dock }
}

describe('requestDockAttention', () => {
  it('bounces the Dock with informational on darwin when the window is not focused', () => {
    const window = makeWindow(false)
    const dock = makeDock()
    const result = requestDockAttention({ platform: 'darwin', window, dock })
    expect(result).toBe('bounced')
    expect(dock.bounce).toHaveBeenCalledTimes(1)
    expect(dock.bounce).toHaveBeenCalledWith('informational')
    expect(window.flashFrame).not.toHaveBeenCalled()
  })

  it('bounces on darwin even when there is no window', () => {
    const dock = makeDock()
    const result = requestDockAttention({ platform: 'darwin', window: null, dock })
    expect(result).toBe('bounced')
    expect(dock.bounce).toHaveBeenCalledWith('informational')
  })

  it.each(['win32', 'linux'] as const)(
    'flashes the frame on %s when the window is not focused',
    (platform) => {
      const window = makeWindow(false)
      const dock = makeDock()
      const result = requestDockAttention({ platform, window, dock })
      expect(result).toBe('flashed')
      expect(window.flashFrame).toHaveBeenCalledTimes(1)
      expect(window.flashFrame).toHaveBeenCalledWith(true)
      expect(dock.bounce).not.toHaveBeenCalled()
    }
  )

  it.each(['darwin', 'win32', 'linux'] as const)(
    'skips with skipped-focused on %s when the window is focused',
    (platform) => {
      const window = makeWindow(true)
      const dock = makeDock()
      const result = requestDockAttention({ platform, window, dock })
      expect(result).toBe('skipped-focused')
      expect(dock.bounce).not.toHaveBeenCalled()
      expect(window.flashFrame).not.toHaveBeenCalled()
    }
  )

  it('returns unsupported on darwin without a dock', () => {
    const { result, window } = run({ platform: 'darwin', dock: undefined })
    expect(result).toBe('unsupported')
    expect(window.flashFrame).not.toHaveBeenCalled()
  })

  it.each(['win32', 'linux'] as const)('returns unsupported on %s without a window', (platform) => {
    const { result, dock } = run({ platform, window: null })
    expect(result).toBe('unsupported')
    expect(dock.bounce).not.toHaveBeenCalled()
  })

  it('returns unsupported on platforms without a Dock or taskbar flash', () => {
    const { result, window, dock } = run({ platform: 'freebsd' })
    expect(result).toBe('unsupported')
    expect(dock.bounce).not.toHaveBeenCalled()
    expect(window.flashFrame).not.toHaveBeenCalled()
  })
})
