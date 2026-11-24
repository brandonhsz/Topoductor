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

test('reading prices needs no affiliate session: any MercadoLibre page will do', async () => {
  const calls: string[][] = []
  const browser = new MeliBrowser(async (args) => {
    calls.push(args)
    if (args.slice(0, 2).join(' ') === 'tab list') {
      return { tabs: [{ browserPageId: 'p', url: 'https://www.mercadolibre.com.mx/l/afiliados' }] }
    }
    if (args[0] === 'eval') {
      return {
        result: JSON.stringify([
          { url: 'https://meli.la/a', ok: true, price: 900, title: 'Vitatú', path: '/social/al1' }
        ])
      }
    }
    return {}
  })
  const read: unknown[] = []
  await browser.readCards(['https://meli.la/a'], async (batch) => {
    read.push(...batch)
  })
  assert.equal(read.length, 1)
  assert.ok(
    !calls.some((args) => args.includes('https://www.mercadolibre.com.mx/afiliados/linkbuilder'))
  )
  assert.equal(
    calls.filter((args) => args[0] === 'eval').length,
    1,
    'no session check before reading'
  )
})

test('from a page outside www.mercadolibre.com.mx, reading starts on the home page', async () => {
  const gotos: string[] = []
  const browser = new MeliBrowser(async (args) => {
    if (args.slice(0, 2).join(' ') === 'tab list') {
      return { tabs: [{ browserPageId: 'p', url: 'https://listado.mercadolibre.com.mx/omega' }] }
    }
    if (args[0] === 'goto') {
      gotos.push(args[4] ?? '')
    }
    return args[0] === 'eval' ? { result: '[]' } : {}
  })
  await browser.readCards(['https://meli.la/a'], async () => undefined)
  assert.deepEqual(gotos, ['https://www.mercadolibre.com.mx/'])
})

test('with a chosen profile, uses only that profile\'s MercadoLibre tab, never another account\'s', async () => {
  const browser = new MeliBrowser(
    async (args) =>
      args.slice(0, 2).join(' ') === 'tab list'
        ? {
            tabs: [
              { browserPageId: 'compras', url: 'https://www.mercadolibre.com.mx/', worktreeId: 'r::/work/a' },
              { browserPageId: 'afiliados', url: 'https://www.mercadolibre.com.mx/x', worktreeId: 'r::/work/a', profileId: 'p-afiliados' }
            ]
          }
        : {},
    '/work/a',
    'p-afiliados'
  )
  assert.equal((await browser.findTab()).browserPageId, 'afiliados')
})

test('with a chosen profile and no tab of it, opens one in that profile', async () => {
  const calls: string[][] = []
  const browser = new MeliBrowser(async (args) => {
    calls.push(args)
    switch (args.slice(0, 2).join(' ')) {
      case 'tab list':
        return { tabs: [{ browserPageId: 'compras', url: 'https://www.mercadolibre.com.mx/', worktreeId: 'r::/work/a' }] }
      case 'worktree list':
        return { worktrees: [{ id: 'r::/work/a' }] }
      case 'tab create':
        return { browserPageId: 'nueva' }
      default:
        return {}
    }
  }, '/work/a', 'p-afiliados')
  assert.equal((await browser.findTab()).browserPageId, 'nueva')
  const create = calls.find((args) => args[0] === 'tab' && args[1] === 'create') ?? []
  assert.deepEqual(create.slice(create.indexOf('--profile'), create.indexOf('--profile') + 2), ['--profile', 'p-afiliados'])
})
