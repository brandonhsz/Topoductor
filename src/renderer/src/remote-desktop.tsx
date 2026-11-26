import './assets/main.css'

import { StrictMode, useEffect } from 'react'
import { RemoteDesktopRoot } from './components/remote-desktop/RemoteDesktopRoot'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import { installRendererCrashDiagnostics } from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { resolvePaintedTheme } from './lib/terminal-app-theme'
import { buildAppFontFamily } from './lib/app-font-family'
import { I18nProvider } from './i18n/I18nProvider'
import { useTranslate } from './i18n/use-translate'
import { useAppStore } from './store'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getOrCreateRendererRoot } from './lib/react-renderer-root'
import { isRemoteDesktopHostId } from '../../shared/remote-desktop/remote-desktop-contract'

installRendererCrashDiagnostics('remote-desktop')

function applyAppearance(settings: GlobalSettings | null): void {
  applyDocumentTheme(resolvePaintedTheme(settings), { disableTransitions: false })
  document.documentElement.style.setProperty(
    '--app-font-family',
    buildAppFontFamily(settings?.appFontFamily)
  )
}

let startupSettings: GlobalSettings | null = null
try {
  startupSettings = window.api.settings.getSync()
} catch {
  // Async hydration below still applies the theme.
}
if (startupSettings) {
  useAppStore.setState({ settings: startupSettings })
}
applyAppearance(startupSettings)

const params = new URLSearchParams(window.location.search)
const hostId = params.get('host')
const title = params.get('title') ?? 'Remote desktop'
document.title = title

function SettingsSync(): null {
  useEffect(() => {
    let disposed = false
    void window.api.settings
      .get()
      .then((settings) => {
        if (!disposed) {
          useAppStore.setState({ settings })
          applyAppearance(settings)
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [])
  return null
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Remote desktop root element not found.')
}

function RemoteDesktopEntry(): React.JSX.Element {
  const t = useTranslate()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="remote-desktop.root"
      surface="remote-desktop"
      title={t('remoteDesktop.recoverableError.title', 'Remote desktop hit an error.')}
      description={t(
        'remoteDesktop.recoverableError.description',
        'Retry to remount it, or close and reopen the window.'
      )}
    >
      {isRemoteDesktopHostId(hostId) ? (
        <RemoteDesktopRoot hostId={hostId} title={title} />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          {t('remoteDesktop.unknownHost', 'Unknown remote host.')}
        </p>
      )}
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <SettingsSync />
      <RemoteDesktopEntry />
    </I18nProvider>
  </StrictMode>
)
