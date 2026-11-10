import type { NativeChatUsageLimitAutoContinueState } from '../../usage/NativeChatUsageLimitAutoContinue'
import { createContext, useContext } from 'react'

/** Host stop details; only hosts known not to support continuation suppress Continue. */
export type NativeChatTopoStopView = {
  hostLabel: string | null
  remoteHost: boolean
  /** The WSL distro a WSL host runs in, so failure rows can name where an agent is missing. */
  wslDistro?: string | null
  continueAvailable: boolean
  offeredTurnItemId: string | null
  continueNow: () => void
  usageLimitTurnItemId: string | null
  usageLimitAutoContinue?: NativeChatUsageLimitAutoContinueState | null
  onUsageLimitHandOffStarted?: () => void
  usageLimitContinueDisabled?: boolean
  continueUsageLimit: (hadFocus?: boolean) => void
}

export const NativeChatTopoStopContext = createContext<NativeChatTopoStopView>({
  hostLabel: null,
  remoteHost: false,
  continueAvailable: false,
  offeredTurnItemId: null,
  continueNow: () => {},
  usageLimitTurnItemId: null,
  continueUsageLimit: () => {}
})

export function useNativeChatTopoStopView(): NativeChatTopoStopView {
  return useContext(NativeChatTopoStopContext)
}
