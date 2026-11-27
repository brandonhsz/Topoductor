import { useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { defaultScopeHost } from '@/runtime/hosts/selection/default-creation-host'
import { signInGitHubOnHost } from '@/runtime/provider-accounts/sign-in/runtime-host-account-sign-in-client'
import { HostAccountSignInPrompt } from '../../settings/accounts/sign-in/HostAccountSignInPrompt'

/** Signs the remote server's own gh in from this device; renders nothing for this desktop. */
export function GitHubHostSignInAction(props: {
  connected: boolean
  onSignedIn: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const settings = useAppStore((s) => s.settings)
  const owner = defaultScopeHost(settings)
  const [running, setRunning] = useState(false)
  if (owner.kind !== 'environment') {
    return null
  }
  const hostLabel = t('integrations.github.hostSignIn.hostLabel', 'the remote server')
  const signIn = (): void => {
    setRunning(true)
    void signInGitHubOnHost(owner)
      .then((login) => {
        toast.success(
          login
            ? t(
                'integrations.github.hostSignIn.doneAs',
                'The server is signed in to GitHub as {{login}}.',
                {
                  login
                }
              )
            : t('integrations.github.hostSignIn.done', 'The server is signed in to GitHub.')
        )
        props.onSignedIn()
      })
      .catch((error: unknown) =>
        toast.error(t('integrations.github.hostSignIn.failed', 'GitHub sign-in did not finish.'), {
          description: error instanceof Error ? error.message : String(error)
        })
      )
      .finally(() => setRunning(false))
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={running} onClick={signIn} className="gap-1.5">
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <LogIn className="size-3.5" />}
        {props.connected
          ? t('integrations.github.hostSignIn.again', 'Sign in again on the server')
          : t('integrations.github.hostSignIn.start', 'Sign in on the server')}
      </Button>
      <HostAccountSignInPrompt owner={owner} provider="github" hostLabel={hostLabel} />
    </div>
  )
}
