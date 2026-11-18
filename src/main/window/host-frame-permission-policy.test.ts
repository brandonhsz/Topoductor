import { describe, expect, it } from 'vitest'
import { HostFrameNavigationRegistry } from './host-frame-navigation-guard'
import { isPluginFramePermissionRequest } from './host-frame-permission-policy'
import { PLUGIN_PANEL_FRAME_NAME_PREFIX } from '../../shared/plugins/frames/plugin-frame-bridge'
import { NATIVE_CHAT_VISUAL_FRAME_NAME_PREFIX } from '../../shared/native-chat/native-chat-visual-shell'

type TestFrame = {
  name: string
  parent: TestFrame | null
  frameTreeNodeId: number
  isDestroyed: () => boolean
}

function frame(name: string, parent: TestFrame | null = null): TestFrame {
  return { name, parent, frameTreeNodeId: Math.random(), isDestroyed: () => false }
}

describe('main-window permission requests from plugin frames', () => {
  const registry = new HostFrameNavigationRegistry()
  const plugin = frame(`${PLUGIN_PANEL_FRAME_NAME_PREFIX}tab`)
  const chatVisual = frame(`${NATIVE_CHAT_VISUAL_FRAME_NAME_PREFIX}x`)
  registry.register(plugin)
  registry.register(chatVisual)

  it('refuses a plugin frame and anything nested in it, even after it renames itself', () => {
    plugin.name = ''
    expect(isPluginFramePermissionRequest({ isMainFrame: false, requestingFrame: plugin })).toBe(
      true
    )
    const nested = frame('inner', frame('deeper', plugin))
    expect(isPluginFramePermissionRequest({ isMainFrame: false, requestingFrame: nested })).toBe(
      true
    )
  })

  it('leaves chat visuals and the app alone', () => {
    expect(
      isPluginFramePermissionRequest({ isMainFrame: false, requestingFrame: chatVisual })
    ).toBe(false)
    // A frame that merely calls itself a plugin frame later was never registered as one.
    expect(
      isPluginFramePermissionRequest({
        isMainFrame: false,
        requestingFrame: frame(`${PLUGIN_PANEL_FRAME_NAME_PREFIX}fake`)
      })
    ).toBe(false)
    expect(isPluginFramePermissionRequest({ isMainFrame: true, requestingFrame: plugin })).toBe(
      false
    )
    expect(isPluginFramePermissionRequest(undefined)).toBe(false)
  })
})
