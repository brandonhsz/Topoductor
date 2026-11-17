import { describe, expect, it } from 'vitest'
import { prepareHarnessCreation, resolveQuickCreationPrompt } from './harness-composer-start'
import { createEmptyHarnessFlow } from './harness-flow-editing'

const flow = createEmptyHarnessFlow({
  name: 'De la intención a la entrega',
  start: 'Inicio',
  intent: 'Intent',
  end: 'Fin'
})

const harness = prepareHarnessCreation(
  { flow, fields: { intent: 'Un botón de saludo' } },
  null,
  'ws'
)!

describe('resolveQuickCreationPrompt', () => {
  it('sends the Harness kickoff as a chat first message', () => {
    expect(
      resolveQuickCreationPrompt({
        harness,
        structuredLaunch: true,
        linkedWorkItem: null,
        note: ''
      })
    ).toEqual({ prompt: harness.kickoff, draftPrompt: null })
  })

  it('sends the protocol-carrying kickoff to a terminal agent', () => {
    expect(
      resolveQuickCreationPrompt({
        harness,
        structuredLaunch: false,
        linkedWorkItem: null,
        note: ''
      })
    ).toEqual({ prompt: harness.terminalKickoff, draftPrompt: null })
  })

  it('keeps a linked item as a draft when no flow is chosen', () => {
    expect(
      resolveQuickCreationPrompt({
        harness: null,
        structuredLaunch: true,
        linkedWorkItem: { number: 7, url: 'https://github.com/o/r/issues/7' },
        note: ''
      })
    ).toEqual({ prompt: '', draftPrompt: 'https://github.com/o/r/issues/7' })
  })
})
