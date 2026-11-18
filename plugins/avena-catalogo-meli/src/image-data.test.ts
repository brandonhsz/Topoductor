import { assert, test } from 'orca/testing'
import { imageFetcher, sizedImageUrl } from './image-data'

const PHOTO = 'https://http2.mlstatic.com/D_NQ_NP_2X_841516-MLA99485644830_112025-O.webp'

test('asks MercadoLibre for the small file of a photo', () => {
  assert.equal(
    sizedImageUrl(PHOTO, 'thumb'),
    'https://http2.mlstatic.com/D_Q_NP_841516-MLA99485644830_112025-E.webp'
  )
  assert.equal(
    sizedImageUrl(PHOTO, 'preview'),
    'https://http2.mlstatic.com/D_Q_NP_2X_841516-MLA99485644830_112025-E.webp'
  )
})

function respond(bytes: number, type = 'image/webp'): typeof fetch {
  return async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': type } })
}

test('keeps every photo small enough for the panel, and only from mlstatic.com', async () => {
  assert.match(
    (await imageFetcher(respond(5_000))(PHOTO, 'thumb')) ?? '',
    /^data:image\/webp;base64,/
  )
  assert.equal(await imageFetcher(respond(200_000))(PHOTO, 'thumb'), null)
  assert.equal(await imageFetcher(respond(5_000, 'image/svg+xml'))(PHOTO, 'thumb'), null)
  assert.equal(await imageFetcher(respond(5_000))('https://example.com/a.webp', 'thumb'), null)
})
