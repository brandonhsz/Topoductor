import React from 'react'
import { AlertCircle, ArrowDownToLine, Clock3, Loader2, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  getSidebarUpdateButtonModel,
  type SidebarUpdateButtonModel
} from './sidebar-update-button-model'
import { useSidebarUpdateButtonActions } from './use-sidebar-update-button-actions'

function getLabel(model: SidebarUpdateButtonModel, t: Translate): string {
  const version = model.version ?? ''
  switch (model.kind) {
    case 'idle':
      return t('sidebar.updateButton.check', 'Check for updates')
    case 'checking':
      return t('sidebar.updateButton.checking', 'Checking for updates…')
    case 'available':
      return t('sidebar.updateButton.available', 'Update to Topo v{{version}}', { version })
    case 'external':
      return t('sidebar.updateButton.external', 'Topo v{{version}} update available', {
        version
      })
    case 'downloading':
      return t('sidebar.updateButton.downloading', 'Downloading update… {{percent}}%', {
        percent: model.percent ?? 0
      })
    case 'ready':
      return t('sidebar.updateButton.ready', 'Update ready: restart to install Topo v{{version}}', {
        version
      })
    case 'installing':
      return t('updates.installBlock.preparingLabel', 'Preparing update')
    case 'waiting':
      return t(
        'updates.installBlock.waitingAriaLabel',
        'Update waiting for other Topo instances. Click to expand.'
      )
    case 'error':
      return t('sidebar.updateButton.failedDetails', 'Update failed. Click for details')
  }
}

function UpdateIcon({ model }: { model: SidebarUpdateButtonModel }): React.JSX.Element {
  switch (model.kind) {
    case 'idle':
      return <RefreshCw className="size-3.5" />
    case 'checking':
    case 'installing':
      return <Loader2 className="size-3.5 animate-spin" />
    case 'waiting':
      return <Clock3 className="size-3.5" />
    case 'error':
      return <AlertCircle className="size-3.5" />
    default:
      return <ArrowDownToLine className="size-3.5" />
  }
}

export function SidebarUpdateButton(): React.JSX.Element | null {
  const status = useAppStore((s) => s.updateStatus)
  if (isWebClientLocation()) {
    return null
  }
  return <SidebarUpdateButtonView model={getSidebarUpdateButtonModel(status)} />
}

function SidebarUpdateButtonView({
  model
}: {
  model: SidebarUpdateButtonModel
}): React.JSX.Element {
  const t = useTranslate()
  const { onClick, installError } = useSidebarUpdateButtonActions(model)
  const label = getLabel(model, t)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={label}
          disabled={model.disabled}
          className={model.badge ? 'relative text-foreground' : 'relative text-muted-foreground'}
          onClick={onClick}
        >
          <UpdateIcon model={model} />
          {model.badge ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
            >
              !
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-64">
        {installError
          ? t('sidebar.updateButton.installFailed', "Couldn't install the update: {{message}}", {
              message: installError
            })
          : label}
      </TooltipContent>
    </Tooltip>
  )
}
