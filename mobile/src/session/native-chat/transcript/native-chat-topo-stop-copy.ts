import type { NativeChatTopoStopSay } from '../../../../../src/shared/native-chat/native-chat-topo-stop-words'
import type { Translate } from '../../../i18n/mobile-i18n'

export function nativeChatTopoStopSay(t: Translate): NativeChatTopoStopSay {
  return (id, machine) => {
    const copy = {
      update: () =>
        t(
          'chat.topoStop.update',
          'Topo on {{machine}} restarted for an update while this response was in progress.',
          { machine }
        ),
      quit: () =>
        t(
          'chat.topoStop.quit',
          'Topo on {{machine}} was closed while this response was in progress.',
          { machine }
        ),
      crash: () =>
        t(
          'chat.topoStop.crash',
          'Topo on {{machine}} stopped unexpectedly while this response was in progress.',
          { machine }
        ),
      remote: () =>
        t(
          'chat.topoStop.remote',
          'Topo on {{machine}} stopped while this response was in progress.',
          { machine }
        ),
      canContinue: () => t('chat.topoStop.canContinue', 'You can continue in this conversation.'),
      unnamedServer: () => t('chat.topoStop.unnamedServer', 'the remote server')
    }
    return copy[id]()
  }
}
