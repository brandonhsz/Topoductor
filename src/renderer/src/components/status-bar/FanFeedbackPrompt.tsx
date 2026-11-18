import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  FAN_FEEDBACK_ANSWERS,
  type FanFeedbackAnswer,
  type FanFeedbackPrompt as FanFeedbackPromptData,
  type FanFeedbackReply
} from '../../../../shared/fan-control-contract'

function answerLabel(answer: FanFeedbackAnswer, t: Translate): string {
  switch (answer) {
    case 'cold':
      return t('auto.components.status.bar.FanFeedbackPrompt.cold', 'Cold')
    case 'warm':
      return t('auto.components.status.bar.FanFeedbackPrompt.warm', 'Warm')
    case 'hot':
      return t('auto.components.status.bar.FanFeedbackPrompt.hot', 'Hot')
  }
}

export function FanFeedbackPrompt({
  prompt,
  pending = false,
  onAnswer
}: {
  prompt: FanFeedbackPromptData
  pending?: boolean
  onAnswer: (reply: FanFeedbackReply) => void
}): React.JSX.Element {
  const t = useTranslate()
  const questionId = useId()

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      data-prompt-id={prompt.id}
      className="flex flex-col gap-2"
    >
      <p id={questionId} className="text-xs text-foreground">
        {t(
          'auto.components.status.bar.FanFeedbackPrompt.question',
          'How does your Mac feel right now (bottom / palm rest)?'
        )}
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {FAN_FEEDBACK_ANSWERS.map((answer) => (
          <Button
            key={answer}
            type="button"
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => onAnswer(answer)}
          >
            {answerLabel(answer, t)}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="self-end"
        disabled={pending}
        onClick={() => onAnswer('never')}
      >
        {t('auto.components.status.bar.FanFeedbackPrompt.never', "Don't ask again")}
      </Button>
    </div>
  )
}
