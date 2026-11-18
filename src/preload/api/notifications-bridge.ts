import { ipcRenderer } from 'electron'
import type {
  NotificationAttentionAcknowledgement,
  NotificationDispatchRequest,
  NotificationDeliveryProbeResult,
  NotificationDismissResult,
  NotificationDispatchResult,
  NotificationPermissionStatusResult,
  NotificationSoundDataResult,
  NotificationSoundPathResult,
  NotificationSoundRequest,
  NotificationSoundResult,
  StructuredNotificationRead
} from '../../shared/notification-settings-types'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { PreloadApi } from '../api-types'

type CachedNotificationSound = { path: string; blobUrl: string; audio: HTMLAudioElement }
// Reuse sound data to avoid reading large files for every notification.
// Why: a separate fallback slot keeps a forced bundled sound from evicting the user's own sound.
const cachedNotificationSounds: Record<'selected' | 'fallback', CachedNotificationSound | null> = {
  selected: null,
  fallback: null
}
type NotificationSoundSlot = keyof typeof cachedNotificationSounds
function disposeCachedNotificationSound(slot: NotificationSoundSlot): void {
  const cached = cachedNotificationSounds[slot]
  if (cached) {
    cached.audio.pause()
    cached.audio.src = ''
    URL.revokeObjectURL(cached.blobUrl)
    cachedNotificationSounds[slot] = null
  }
}

export const notificationsApi = {
  getDesktopAwayState: (): Promise<boolean | undefined> =>
    ipcRenderer.invoke('notifications:getDesktopAwayState'),
  dispatch: (args: Record<string, unknown>): Promise<NotificationDispatchResult> =>
    ipcRenderer.invoke('notifications:dispatch', args),
  acknowledgeAttention: (
    acknowledgement: NotificationAttentionAcknowledgement,
    executionHost?: NotificationDispatchRequest['executionHost']
  ): Promise<NotificationDismissResult> =>
    ipcRenderer.invoke('notifications:acknowledgeAttention', acknowledgement, executionHost),
  dismiss: (
    ids: string[],
    paneKeys?: string[],
    reads?: StructuredNotificationRead[]
  ): Promise<NotificationDismissResult> =>
    reads === undefined
      ? ipcRenderer.invoke('notifications:dismiss', ids, paneKeys)
      : ipcRenderer.invoke('notifications:dismiss', ids, paneKeys, reads),
  settleStructuredPrompts: (
    scope: AgentSessionExecutionLocation,
    sessionId: string,
    executionHost?: NotificationDispatchRequest['executionHost']
  ): Promise<void> =>
    ipcRenderer.invoke('notifications:settleStructuredPrompts', scope, sessionId, executionHost),
  openSystemSettings: (): Promise<void> => ipcRenderer.invoke('notifications:openSystemSettings'),
  getPermissionStatus: (): Promise<NotificationPermissionStatusResult> =>
    ipcRenderer.invoke('notifications:getPermissionStatus'),
  probeDelivery: (args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> =>
    ipcRenderer.invoke('notifications:probeDelivery', args),
  playSound: async (options?: NotificationSoundRequest): Promise<NotificationSoundResult> => {
    const soundRequest = options?.soundId ? { soundId: options.soundId } : undefined
    const slot: NotificationSoundSlot = soundRequest ? 'fallback' : 'selected'
    try {
      const resolved: NotificationSoundPathResult = await ipcRenderer.invoke(
        'notifications:resolveSoundPath',
        ...(soundRequest ? [soundRequest] : [])
      )
      if (!resolved.ok) {
        disposeCachedNotificationSound(slot)
        return { played: false, reason: resolved.reason }
      }

      let entry = cachedNotificationSounds[slot]
      if (!entry || entry.path !== resolved.path) {
        const sound: NotificationSoundDataResult = await ipcRenderer.invoke(
          'notifications:loadSound',
          ...(soundRequest ? [soundRequest] : [])
        )
        if (!sound.ok) {
          disposeCachedNotificationSound(slot)
          return { played: false, reason: sound.reason }
        }
        // Another playSound may have populated the cache during this load.
        const latestEntry = cachedNotificationSounds[slot]
        if (latestEntry?.path === sound.path) {
          entry = latestEntry
        } else {
          const arrayBuffer = new ArrayBuffer(sound.data.byteLength)
          new Uint8Array(arrayBuffer).set(sound.data)
          const blob = new Blob([arrayBuffer], { type: sound.mimeType })
          disposeCachedNotificationSound(slot)
          const blobUrl = URL.createObjectURL(blob)
          entry = { path: sound.path, blobUrl, audio: new Audio(blobUrl) }
          cachedNotificationSounds[slot] = entry
        }
      }

      const audio = entry.audio
      // Replay from the start so bursts do not stack copies.
      audio.currentTime = 0
      if (typeof options?.volume === 'number' && Number.isFinite(options.volume)) {
        audio.volume = Math.min(1, Math.max(0, options.volume / 100))
      }
      try {
        await audio.play()
      } catch {
        return { played: false, reason: 'playback-failed' }
      }
      return { played: true }
    } catch {
      return { played: false, reason: 'playback-failed' }
    }
  }
} satisfies PreloadApi['notifications']
