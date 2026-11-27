import { useRef } from 'react'
import { ExternalLink, Loader2, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { RemoteDesktopHostId } from '../../../../shared/remote-desktop/remote-desktop-contract'
import { RemoteDesktopCredentialForm } from './RemoteDesktopCredentialForm'
import { useRemoteDesktopSession } from './use-remote-desktop-session'

export function RemoteDesktopRoot({
  hostId,
  title,
  embedded = false,
  onPopOut,
  onClose
}: {
  hostId: RemoteDesktopHostId
  title: string
  /** Inside the main window it fills its page instead of the whole window. */
  embedded?: boolean
  onPopOut?: () => void
  onClose?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const screen = useRef<HTMLDivElement | null>(null)
  const { state, reconnect, submitCredentials, sendCtrlAltDel } = useRemoteDesktopSession(
    hostId,
    screen
  )

  return (
    <div
      className={
        embedded
          ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground'
          : 'flex h-screen w-screen flex-col bg-background text-foreground'
      }
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">
          {state.phase === 'connected'
            ? t('remoteDesktop.status.connected', 'Connected')
            : state.phase === 'connecting'
              ? t('remoteDesktop.status.connecting', 'Connecting…')
              : state.phase === 'credentials'
                ? t('remoteDesktop.status.credentials', 'Waiting for sign-in')
                : t('remoteDesktop.status.disconnected', 'Disconnected')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {state.phase === 'connected' && (
            <Button variant="ghost" size="sm" onClick={sendCtrlAltDel}>
              {t('remoteDesktop.ctrlAltDel', 'Send Ctrl+Alt+Del')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={reconnect}>
            <RotateCw className="size-4" />
            {t('remoteDesktop.reconnect', 'Reconnect')}
          </Button>
          {onPopOut ? (
            <Button variant="ghost" size="sm" onClick={onPopOut}>
              <ExternalLink className="size-4" />
              {t('remoteDesktop.popOut', 'Open in window')}
            </Button>
          ) : null}
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t('remoteDesktop.close', 'Close remote desktop')}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>
      <main className="relative min-h-0 flex-1 bg-black">
        <div ref={screen} className="absolute inset-0" data-testid="remote-desktop-screen" />
        {state.phase !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background p-6">
            {state.phase === 'connecting' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('remoteDesktop.connecting', 'Connecting to the remote desktop…')}
              </div>
            )}
            {state.phase === 'credentials' && (
              <RemoteDesktopCredentialForm
                key={`${state.prompt.reason}-${state.error ?? ''}`}
                prompt={state.prompt}
                error={state.error}
                onSubmit={submitCredentials}
              />
            )}
            {state.phase === 'error' && (
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <p className="text-sm font-medium">
                  {t('remoteDesktop.errorTitle', 'Could not show the remote desktop')}
                </p>
                <p className="text-sm text-muted-foreground">{state.error.message}</p>
                <Button onClick={reconnect}>{t('remoteDesktop.reconnect', 'Reconnect')}</Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
