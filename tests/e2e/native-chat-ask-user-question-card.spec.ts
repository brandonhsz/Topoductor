import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/topo-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { waitForPtyShellEcho } from './terminal-pty-readiness'
import type { GlobalSettings } from '../../src/shared/global-settings-types'

const QUESTION = 'Tabs or spaces?'

async function enableNativeChatSetting(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const nextSettings = await window.api.settings.set({
      nativeChatProviders: { claude: true, codex: true }
    })
    window.__store?.setState({ settings: nextSettings as GlobalSettings })
  })
}

// #11761: model paired-headless status with identity/working state but no interactivePrompt/toolName; only the transcript carries the ask.
async function seedStatusWithoutAskPayload(
  page: Page,
  args: { paneKey: string; worktreeId: string; sessionId: string; transcriptPath: string }
): Promise<void> {
  await page.evaluate(({ paneKey, worktreeId, sessionId, transcriptPath }) => {
    window.__store
      ?.getState()
      .setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'AskUserQuestion card proof', agentType: 'claude' },
        'Claude',
        undefined,
        { worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
  }, args)
}

async function toggleTerminalTabToChatView(
  page: Page,
  args: { tabId: string; worktreeId: string }
): Promise<void> {
  await page.evaluate(({ tabId, worktreeId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const unifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!unifiedTab) {
      throw new Error('Unified terminal tab not found for chat toggle')
    }
    state.toggleTabViewMode(unifiedTab.id)
  }, args)
}

/** A transcript whose last assistant turn leaves an AskUserQuestion unanswered. */
function pendingAskTranscript(args: { sessionId: string; userText: string }): string {
  const userTime = new Date()
  const assistantTime = new Date(userTime.getTime() + 2_000)
  const lines = [
    {
      sessionId: args.sessionId,
      uuid: `${args.sessionId}-user`,
      timestamp: userTime.toISOString(),
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: args.userText }] }
    },
    {
      sessionId: args.sessionId,
      uuid: `${args.sessionId}-assistant`,
      timestamp: assistantTime.toISOString(),
      type: 'assistant',
      message: {
        model: 'claude-opus-4',
        content: [
          { type: 'text', text: 'Before I reformat the file I need one decision from you.' },
          {
            type: 'tool_use',
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: QUESTION,
                  header: 'Style',
                  multiSelect: false,
                  options: [{ label: 'Tabs' }, { label: 'Spaces' }]
                }
              ]
            }
          }
        ]
      }
    }
  ]
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
}

test.describe('Desktop chat AskUserQuestion card (#11761)', () => {
  test('renders the answerable question card from the transcript when live status carries no ask', async ({
    topoPage
  }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
    await waitForActiveTerminalManager(topoPage, 30_000)

    const boundPane = await waitForPaneIdentitySnapshot(topoPage, 1)
    const ptyId = await waitForActivePanePtyId(topoPage)
    await waitForPtyShellEcho(topoPage, ptyId, 15_000)
    const descriptor = await waitForActivePaneHookDescriptor(topoPage)
    expect(descriptor.paneKey).toBe(`${boundPane.tabId}:${boundPane.activeLeafId}`)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-ask-card-${randomUUID()}`

    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'topo-e2e-ask-card-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)
    const screenshotDir = path.join(process.cwd(), 'validation-screenshots', 'ask-user-question')
    mkdirSync(screenshotDir, { recursive: true })

    try {
      const userText = 'Reformat the config file for me'
      writeFileSync(transcriptPath, pendingAskTranscript({ sessionId, userText }))

      await enableNativeChatSetting(topoPage)
      await seedStatusWithoutAskPayload(topoPage, {
        paneKey: descriptor.paneKey,
        worktreeId: descriptor.worktreeId,
        sessionId,
        transcriptPath
      })
      await toggleTerminalTabToChatView(topoPage, { tabId, worktreeId: descriptor.worktreeId })

      await expect(topoPage.locator('[data-native-chat-root="true"]')).toBeVisible({
        timeout: 15_000
      })
      await expect(topoPage.getByText(userText)).toBeVisible({ timeout: 30_000 })

      // Gate on the card’s title: awaiting-input transcript rows also contain the question (#20724).
      const cardQuestion = topoPage
        .getByTestId('native-chat-question-card-title')
        .filter({ hasText: QUESTION })
      await expect(cardQuestion).toBeVisible({ timeout: 10_000 })
      await expect(topoPage.getByRole('button', { name: /Spaces/ })).toBeVisible()
      await topoPage.screenshot({ path: path.join(screenshotDir, '01-question-card.png') })

      // A final single-select pick auto-submits (#26288), proving the card accepts answers.
      await topoPage.getByRole('button', { name: /Spaces/ }).click()
      // Require card dismissal and composer return; the transcript keeps its resolution receipt.
      await expect(cardQuestion).toHaveCount(0, { timeout: 20_000 })
      await topoPage.screenshot({ path: path.join(screenshotDir, '03-answered.png') })
      const finalPane = await waitForPaneIdentitySnapshot(topoPage, 1)
      expect(finalPane.tabId).toBe(boundPane.tabId)
      expect(finalPane.activeLeafId).toBe(boundPane.activeLeafId)
      expect(finalPane.ptyIdsByLeafId).toEqual(boundPane.ptyIdsByLeafId)
      await expect(topoPage.locator('[data-native-chat-root="true"]')).toBeVisible()
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})
