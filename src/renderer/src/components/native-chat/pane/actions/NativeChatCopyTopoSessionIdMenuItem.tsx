import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'

/** Copies the chat's Topo session ID from the host: `topo_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyTopoSessionIdMenuItem({
  resolveTopoSessionId
}: {
  resolveTopoSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const t = useTranslate()
  const copyTopoSessionId = async (): Promise<void> => {
    try {
      const topoSessionId = await resolveTopoSessionId()
      if (!topoSessionId) {
        throw new Error('no Topo session ID')
      }
      await window.api.ui.writeClipboardText(topoSessionId)
      toast.success(
        t('components.native-chat.contextMenu.topoSessionIdCopied', 'Topo session ID copied')
      )
    } catch {
      toast.error(
        t(
          'components.native-chat.contextMenu.topoSessionIdCopyFailed',
          'Unable to copy Topo session ID'
        )
      )
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyTopoSessionId()}>
          <Copy />
          {t('components.native-chat.contextMenu.copyTopoSessionId', 'Copy Topo Session ID')}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {t(
          'components.native-chat.contextMenu.topoSessionIdTooltip',
          "Topo's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through Topo."
        )}
      </TooltipContent>
    </Tooltip>
  )
}
