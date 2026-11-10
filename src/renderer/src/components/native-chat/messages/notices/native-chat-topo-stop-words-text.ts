import { translate } from '@/i18n/i18n'
import {
  NATIVE_CHAT_TOPO_STOP_COPY as COPY,
  type NativeChatTopoStopCopyId,
  type NativeChatTopoStopSay
} from '../../../../../../shared/native-chat/native-chat-topo-stop-words'

const PIECES: Record<NativeChatTopoStopCopyId, (machine: string | undefined) => string> = {
  update: (machine) =>
    translate('components.native-chat.notices.topoStopUpdate', COPY.update, { machine }),
  quit: (machine) =>
    translate('components.native-chat.notices.topoStopQuit', COPY.quit, { machine }),
  crash: (machine) =>
    translate('components.native-chat.notices.topoStopCrash', COPY.crash, { machine }),
  remote: (machine) =>
    translate('components.native-chat.notices.topoStopRemote', COPY.remote, { machine }),
  canContinue: () =>
    translate('components.native-chat.notices.topoStopCanContinue', COPY.canContinue),
  unnamedServer: () =>
    translate('components.native-chat.notices.topoStopUnnamedServer', COPY.unnamedServer)
}

export const sayNativeChatTopoStopTranslated: NativeChatTopoStopSay = (id, machine) =>
  PIECES[id](machine)
