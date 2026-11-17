import { defineFixture } from '../../../component-fixtures/component-fixture'
import { NativeChatHarnessProgress } from './NativeChatHarnessProgress'

const progress = {
  group: 'Bloque 1 · Mesa',
  done: 1,
  total: 3,
  agents: [
    {
      title: 'Security critic',
      status: 'done' as const,
      output:
        'No critical findings.\nThe token refresh path keeps the old session until the new one is confirmed.'
    },
    {
      title: 'UX critic',
      status: 'failed' as const,
      output: 'The Retry button has no visible focus ring.'
    },
    { title: 'Test critic', status: 'running' as const, output: 'partial draft' }
  ]
}

export const collapsed = defineFixture({
  width: 560,
  render: () => <NativeChatHarnessProgress progress={progress} />
})

export const expanded = defineFixture({
  width: 560,
  render: () => <NativeChatHarnessProgress progress={progress} />,
  interact: (frame) => frame.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
})
