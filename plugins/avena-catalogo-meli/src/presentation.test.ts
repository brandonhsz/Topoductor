import { assert, test } from 'orca/testing'
import { formatSize, parseSizes, savedSize, sizeMismatch, sizeNote } from './presentation'

test('reads package sizes and ignores doses', () => {
  assert.deepEqual(parseSizes('Falcon Performance | Chocolate | 1.14kg Choco Bronze'), [
    { kind: 'mass', value: 1140 }
  ])
  assert.deepEqual(parseSizes('Multivitamínico 180 Cáps B Life'), [{ kind: 'pieces', value: 180 }])
  assert.deepEqual(parseSizes('Biotina 10,000 mcg, 1 cápsula'), [])
  assert.deepEqual(parseSizes('Aceite 1,5 l'), [{ kind: 'volume', value: 1500 }])
  assert.equal(formatSize({ kind: 'mass', value: 1140 }), '1.14 kg')
})

test('the product name wins over a saved presentation that says otherwise', () => {
  assert.deepEqual(savedSize('falcon performance choco bronze 722 g', '1.14 kg'), [
    { kind: 'mass', value: 722 }
  ])
  assert.deepEqual(savedSize('falcon protein', '510 g'), [{ kind: 'mass', value: 510 }])
})

test('another size of the same product is flagged, rounding is not', () => {
  const falcon = 'Birdman Falcon Protein Proteína Vegetal | Chocolate | 480g'
  assert.equal(
    sizeNote('falcon protein chocolate 510 g', '510 g', falcon),
    '480 g en MercadoLibre, 510 g guardado'
  )
  assert.equal(sizeMismatch(savedSize('fitmingo 1.02 kg', null), 'Fitmingo | 1020 g'), null)
  assert.equal(sizeMismatch(savedSize('mct oil', null), 'MCT Oil 500 ml'), null)
})
