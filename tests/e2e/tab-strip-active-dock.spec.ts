import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/topo-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const STRIP = '.terminal-tab-strip'

function slotSelector(tabId: string): string {
  return `${STRIP} > [data-tab-strip-slot="${tabId}"]`
}

async function createBackgroundTerminalTab(page: Page, worktreeId: string): Promise<string> {
  return page.evaluate(
    (wId) =>
      window.__store!.getState().createTab(wId, undefined, undefined, { activate: false }).id,
    worktreeId
  )
}

async function readStripSlotIds(page: Page): Promise<string[]> {
  return page.$$eval(`${STRIP} > [data-tab-strip-slot]`, (nodes) =>
    nodes.map((node) => node.getAttribute('data-tab-strip-slot') ?? '')
  )
}

/** Where `tabId` is drawn relative to the strip's visible viewport, in px. */
async function readSlotViewportSpan(
  page: Page,
  tabId: string
): Promise<{ left: number; right: number; viewLeft: number; viewRight: number }> {
  return page.evaluate(
    ({ strip, slot }) => {
      const stripEl = document.querySelector<HTMLElement>(strip)!
      const slotRect = document.querySelector<HTMLElement>(slot)!.getBoundingClientRect()
      const viewLeft = stripEl.getBoundingClientRect().left + stripEl.clientLeft
      return {
        left: slotRect.left,
        right: slotRect.right,
        viewLeft,
        viewRight: viewLeft + stripEl.clientWidth
      }
    },
    { strip: STRIP, slot: slotSelector(tabId) }
  )
}

async function isSlotInView(page: Page, tabId: string): Promise<boolean> {
  const span = await readSlotViewportSpan(page, tabId)
  return span.left >= span.viewLeft - 1 && span.right <= span.viewRight + 1
}

async function nextFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame)
    }
  }, count)
}

test.describe('Tab strip active-tab dock', () => {
  test.beforeEach(async ({ topoPage }) => {
    await waitForSessionReady(topoPage)
    await waitForActiveWorktree(topoPage)
    await ensureTerminalVisible(topoPage)
  })

  for (const edge of ['start', 'end'] as const) {
    test(`keeps inactive tabs clickable in a strip too narrow for the ${edge} dock`, async ({
      topoPage
    }) => {
      const worktreeId = await waitForActiveWorktree(topoPage)
      for (let i = 0; i < 3; i++) {
        await createBackgroundTerminalTab(topoPage, worktreeId)
      }
      const ids = await readStripSlotIds(topoPage)
      const activeTabId = (edge === 'start' ? ids.at(0) : ids.at(-1))!
      const inactiveTabId = (edge === 'start' ? ids.at(-1) : ids.at(0))!
      const activeTab = topoPage.locator(
        `${slotSelector(activeTabId)} [data-testid="sortable-tab"]`
      )
      const inactiveTab = topoPage.locator(
        `${slotSelector(inactiveTabId)} [data-testid="sortable-tab"]`
      )
      await activeTab.click()

      const strip = topoPage.locator(STRIP).first()
      await strip.evaluate((el) => {
        el.style.maxWidth = '200px'
      })
      await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
      await strip.evaluate((el, side) => {
        el.scrollLeft = side === 'start' ? el.scrollWidth : 0
      }, edge)
      await expect.poll(() => isSlotInView(topoPage, inactiveTabId)).toBe(true)
      await inactiveTab.click()
      await expect(inactiveTab).toHaveAttribute('data-active', 'true')
      await activeTab.locator('[data-tab-close-button]').click()
      await expect(activeTab).toHaveCount(0)

      await strip.evaluate((el) => {
        el.style.maxWidth = '400px'
      })
      await expect(strip).not.toHaveAttribute('data-active-tab-dock-disabled')
      await strip.evaluate((el, side) => {
        el.scrollLeft = side === 'start' ? 0 : el.scrollWidth
      }, edge)
      await expect(strip).toHaveAttribute(
        'data-active-tab-docked',
        edge === 'start' ? 'end' : 'start'
      )
      expect(await isSlotInView(topoPage, inactiveTabId)).toBe(true)
    })
  }

  test('keeps inactive tabs clickable after cancelling a drag that scrolled a narrow strip', async ({
    topoPage
  }) => {
    const worktreeId = await waitForActiveWorktree(topoPage)
    for (let i = 0; i < 3; i++) {
      await createBackgroundTerminalTab(topoPage, worktreeId)
    }
    const ids = await readStripSlotIds(topoPage)
    const activeSlot = topoPage.locator(slotSelector(ids[0]))
    const activeTab = activeSlot.locator('[data-testid="sortable-tab"]')
    const inactiveTab = topoPage.locator(`${slotSelector(ids[1])} [data-testid="sortable-tab"]`)
    await activeTab.click()

    const strip = topoPage.locator(STRIP).first()
    await strip.evaluate((el) => {
      el.style.maxWidth = '200px'
    })
    await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    await expect.poll(() => isSlotInView(topoPage, ids[0])).toBe(true)

    const box = (await activeTab.boundingBox())!
    const y = box.y + box.height / 2
    await topoPage.mouse.move(box.x + 20, y)
    await topoPage.mouse.down()
    await topoPage.mouse.move(box.x + 34, y)
    await topoPage.mouse.move(box.x + 38, y)
    await expect(strip.locator('[data-active-tab-dock]')).toHaveCount(0)

    // Hidden-window drag overlays can intercept native wheel input before it reaches the strip.
    await strip.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 144, cancelable: true }))
    })
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBe(144)
    await nextFrames(topoPage, 2)
    await topoPage.evaluate(() => window.dispatchEvent(new Event('blur')))
    await topoPage.mouse.up()

    await expect(activeSlot).toHaveAttribute('data-active-tab-dock', '')
    await expect(strip).toHaveAttribute('data-active-tab-dock-disabled', '')
    await inactiveTab.click()
    await expect(inactiveTab).toHaveAttribute('data-active', 'true')
  })
})
