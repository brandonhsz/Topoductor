import React, { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'

export function AppVersionStatusSegment(): React.JSX.Element | null {
  const t = useTranslate()
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.updater
      .getVersion()
      .then((value) => {
        if (!cancelled) {
          setVersion(value)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Why: the paired web client reports 'web' instead of a real build version.
  if (!version || version === 'web') {
    return null
  }

  return (
    <span
      className="shrink-0 px-1 py-0.5 text-2xs tabular-nums text-muted-foreground"
      aria-label={t('statusBar.appVersion.ariaLabel', 'Topo version {{version}}', { version })}
    >
      v{version}
    </span>
  )
}
