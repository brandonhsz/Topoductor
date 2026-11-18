// @vitest-environment happy-dom

import { createContext, useContext, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FanFeedbackPrompt as FanFeedbackPromptData } from '../../../../shared/fan-control-contract'
import { FanFeedbackPrompt } from './FanFeedbackPrompt'

// Radix portals are not under test; a controlled `open` renders content inline.
vi.mock('@/components/ui/popover', () => {
  const OpenContext = createContext(false)
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  function Popover({
    children,
    open,
    defaultOpen
  }: {
    children?: ReactNode
    open?: boolean
    defaultOpen?: boolean
  }) {
    const [inner] = useState(defaultOpen ?? false)
    return <OpenContext.Provider value={open ?? inner}>{children}</OpenContext.Provider>
  }
  function PopoverContent({ children }: { children?: ReactNode }) {
    return useContext(OpenContext) ? <div role="dialog">{children}</div> : null
  }
  return {
    Popover,
    PopoverTrigger: Pass,
    PopoverAnchor: Pass,
    PopoverArrow: () => null,
    PopoverContent
  }
})
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: Pass, TooltipProvider: Pass }
})

const PROMPT: FanFeedbackPromptData = { id: 'prompt-1', askedAt: 1_700_000_000_000, tempC: 62 }

afterEach(cleanup)

function renderPrompt(pending = false): ReturnType<typeof vi.fn> {
  const onAnswer = vi.fn()
  render(<FanFeedbackPrompt prompt={PROMPT} pending={pending} onAnswer={onAnswer} />)
  return onAnswer
}

describe('FanFeedbackPrompt', () => {
  it('asks how the bottom and palm rest of the Mac feel', () => {
    renderPrompt()
    expect(screen.getByText(/feel/i).textContent).toMatch(/palm rest/i)
  })

  it.each([
    [/^cold$/i, 'cold'],
    [/^warm$/i, 'warm'],
    [/^hot$/i, 'hot']
  ] as const)('answers %s', (name, reply) => {
    const onAnswer = renderPrompt()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name }))
    })
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith(reply)
  })

  it('offers "Don\'t ask again", which replies never', () => {
    const onAnswer = renderPrompt()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /ask again/i }))
    })
    expect(onAnswer).toHaveBeenCalledWith('never')
  })

  it('disables every answer while one is being sent', () => {
    const onAnswer = renderPrompt(true)
    for (const name of [/^cold$/i, /^warm$/i, /^hot$/i, /ask again/i]) {
      const button = screen.getByRole('button', { name })
      expect(button.hasAttribute('disabled')).toBe(true)
      fireEvent.click(button)
    }
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
