import { describe, expect, it, vi } from 'vitest'
import { PluginInstallLinkState } from './skill-share-deep-link-state'
import { isRoutedTopoDeepLink } from './topo-deep-link-url'

const LINK = 'topo://plugins/acme.dusk?catalog=community'

describe('PluginInstallLinkState', () => {
  it('queues a cold-start link until the renderer pulls it', () => {
    const state = new PluginInstallLinkState()
    expect(state.capture(['/Applications/Topo.app/Contents/MacOS/Topo', LINK])).toBe(true)
    expect(state.consume()).toBe(LINK)
    expect(state.consume()).toBeNull()
  })

  it('publishes a second-instance link and keeps malformed ones for the error toast', () => {
    const state = new PluginInstallLinkState()
    const publish = vi.fn()
    expect(state.capture(['topo.exe', 'topo://plugins/not valid'], publish)).toBe(true)
    expect(publish).toHaveBeenCalledWith('topo://plugins/not valid')
    expect(state.capture(['topo.exe', '--flag'], publish)).toBe(false)
  })

  it('drops repeats and bursts', () => {
    let now = 0
    const state = new PluginInstallLinkState(() => now)
    const publish = vi.fn()
    state.capture([LINK], publish)
    state.capture([LINK], publish)
    expect(publish).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 10; index += 1) {
      state.capture([`topo://plugins/acme.p${index}`], publish)
    }
    expect(publish).toHaveBeenCalledTimes(5)
    now = 5_000
    state.capture([LINK], publish)
    expect(publish).toHaveBeenCalledTimes(6)
  })
})

describe('isRoutedTopoDeepLink', () => {
  it('claims plugin and skill links on macOS open-url, nothing else', () => {
    expect(isRoutedTopoDeepLink(LINK)).toBe(true)
    expect(isRoutedTopoDeepLink('topo://plugins/bad')).toBe(true)
    expect(isRoutedTopoDeepLink('topo://skills/share/abc_1')).toBe(true)
    expect(isRoutedTopoDeepLink('topo://pair?code=x')).toBe(false)
    expect(isRoutedTopoDeepLink('https://example.com/plugins/acme.dusk')).toBe(false)
  })
})
