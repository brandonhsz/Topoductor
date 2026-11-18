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
