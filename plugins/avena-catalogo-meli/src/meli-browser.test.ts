import { assert, test } from 'orca/testing'
import { MeliBrowser } from './meli-browser'

test('opens MercadoLibre in a named workspace when no tab is open', async () => {
  const calls: string[][] = []
  const browser = new MeliBrowser(async (args) => {
    calls.push(args)
    switch (args.slice(0, 2).join(' ')) {
      case 'tab list':
        return { tabs: [] }
      case 'worktree list':
        return { worktrees: [{ id: 'repo::/work/a' }] }
      case 'tab create':
        return { browserPageId: 'page-1' }
      case 'eval --page':
        return { result: JSON.stringify([]) }
      default:
        return {}
    }
  })
  assert.deepEqual(await browser.search('b life probiotics'), [])
  const create = calls.find((args) => args[0] === 'tab' && args[1] === 'create')
  assert.deepEqual(create?.slice(-2), ['--worktree', 'id:repo::/work/a'])
})

test('with a chosen workspace, uses its MercadoLibre tab and ignores tabs elsewhere', async () => {
  const browser = new MeliBrowser(
    async (args) =>
      args.slice(0, 2).join(' ') === 'tab list'
        ? {
            tabs: [
              {
                browserPageId: 'other',
                url: 'https://www.mercadolibre.com.mx/',
                worktreeId: 'r::/work/b'
              },
              {
                browserPageId: 'mine',
                url: 'https://www.mercadolibre.com.mx/x',
                worktreeId: 'r::/work/a'
              }
            ]
          }
        : {},
    '/work/a'
  )
  assert.deepEqual(await browser.findTab(), {
    browserPageId: 'mine',
    url: 'https://www.mercadolibre.com.mx/x',
    worktreeId: 'r::/work/a'
  })
})

test('with a chosen workspace and no tab there, opens one in that workspace', async () => {
  const calls: string[][] = []
  const browser = new MeliBrowser(async (args) => {
    calls.push(args)
    switch (args.slice(0, 2).join(' ')) {
      case 'tab list':
        return {
          tabs: [
            {
              browserPageId: 'other',
              url: 'https://www.mercadolibre.com.mx/',
              worktreeId: 'r::/work/b'
            }
          ]
        }
      case 'worktree list':
        return {
          worktrees: [
            { id: 'r::/work/b', path: '/work/b' },
            { id: 'r::/work/a', path: '/work/a' }
          ]
        }
      case 'tab create':
        return { browserPageId: 'new' }
      default:
        return {}
    }
  }, '/work/a/')
  const tab = await browser.findTab()
  assert.equal(tab.browserPageId, 'new')
  const create = calls.find((args) => args[0] === 'tab' && args[1] === 'create')
  assert.deepEqual(create?.slice(-2), ['--worktree', 'id:r::/work/a'])
})
