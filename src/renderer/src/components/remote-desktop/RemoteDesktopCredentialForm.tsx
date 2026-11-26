import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import type { RemoteDesktopCredentialInput } from '../../../../shared/remote-desktop/remote-desktop-contract'
import type { RemoteDesktopCredentialPrompt } from './use-remote-desktop-session'

export function RemoteDesktopCredentialForm({
  prompt,
  error,
  onSubmit
}: {
  prompt: RemoteDesktopCredentialPrompt
  error?: string
  onSubmit: (input: RemoteDesktopCredentialInput) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const shownError = saveError ?? error ?? null

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!password || (prompt.needsUsername && !username.trim())) {
      return
    }
    setSubmitting(true)
    setSaveError(null)
    try {
      await onSubmit({ username: prompt.needsUsername ? username.trim() : null, password })
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">
          {prompt.reason === 'rejected'
            ? t('remoteDesktop.credentials.rejectedTitle', 'Sign-in failed')
            : t('remoteDesktop.credentials.title', 'Sign in to this computer')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {prompt.needsUsername
            ? t(
                'remoteDesktop.credentials.macDescription',
                'Use the account name and password of a user on the remote computer. Topo stores them encrypted in your system keychain.'
              )
            : t(
                'remoteDesktop.credentials.vncDescription',
                'Enter the screen sharing password set on the remote computer. Topo stores it encrypted in your system keychain.'
              )}
        </p>
      </div>
      {prompt.needsUsername && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remote-desktop-username">
            {t('remoteDesktop.credentials.username', 'Account name')}
          </Label>
          <Input
            id="remote-desktop-username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remote-desktop-password">
          {t('remoteDesktop.credentials.password', 'Password')}
        </Label>
        <Input
          id="remote-desktop-password"
          type="password"
          autoComplete="current-password"
          autoFocus={!prompt.needsUsername}
          aria-invalid={shownError ? true : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {shownError && <p className="text-xs text-destructive">{shownError}</p>}
      </div>
      <Button
        type="submit"
        disabled={submitting || !password || (prompt.needsUsername && !username.trim())}
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {t('remoteDesktop.credentials.submit', 'Connect')}
      </Button>
    </form>
  )
}
