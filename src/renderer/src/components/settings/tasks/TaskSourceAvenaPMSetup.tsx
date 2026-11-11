import { Button } from '@/components/ui/button'
import { TaskSourceShowInTasksStep } from './TaskSourceShowInTasksStep'
import { TaskSourceStepRow } from './TaskSourceStepRow'
import { useTranslate } from '@/i18n/use-translate'
import { getConnectStepState, type ConnectStepProps } from './task-source-setup-state'
import {
  connectAvenaPM,
  disconnectAvenaPM,
  useAvenaPMConnection
} from '@/components/task-page/avenapm/avenapm-connection-store'

export function AvenaPMSetupSteps(props: ConnectStepProps): React.JSX.Element {
  const t = useTranslate()
  const { connecting, status } = useAvenaPMConnection()
  return (
    <ol className="divide-y divide-border/50">
      <TaskSourceStepRow
        index={1}
        state={getConnectStepState(props)}
        title={t('auto.components.settings.TasksPane.connectAvenaPMTitle', 'Sign in to AvenaPM')}
        description={
          status?.connected
            ? t('auto.components.settings.TasksPane.avenapmSignedInAs', 'Signed in as {{value0}}', {
                value0: status.user.email
              })
            : t(
                'auto.components.settings.TasksPane.connectAvenaPMDescription',
                'Use your Avena Google account in the browser; Topo keeps a personal token.'
              )
        }
        action={
          <Button
            type="button"
            size="sm"
            variant={props.connected ? 'outline' : 'default'}
            disabled={connecting}
            onClick={() => void (props.connected ? disconnectAvenaPM() : connectAvenaPM())}
          >
            {props.connected
              ? t('auto.components.settings.TasksPane.signOutAvenaPM', 'Sign out')
              : t('auto.components.settings.TasksPane.signInAvenaPM', 'Sign in with Google')}
          </Button>
        }
      />
      <TaskSourceShowInTasksStep
        index={2}
        providerLabel="AvenaPM"
        visible={props.visible}
        canHide={props.canHide}
        onToggleVisible={props.onToggleVisible}
      />
    </ol>
  )
}
