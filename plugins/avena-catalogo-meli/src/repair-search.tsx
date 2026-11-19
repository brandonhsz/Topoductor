import { atom, Button, Image, Input, plugin, read, Row, set, Stack, Text } from 'orca'
import { busy, runAction, selectedId } from './panel-state'
import { sizeNote } from './presentation'
import type { Product, SearchCandidate } from './protocol'

const query = atom('')
const results = atom<{ productId: string; candidates: SearchCandidate[] } | null>(null)

// A whole render is capped at 512 KiB: an oversized photo saved by an older version is skipped.
const MAX_IMAGE_LENGTH = 40_000

function shown(image: string | null | undefined): string | null {
  return image && image.length <= MAX_IMAGE_LENGTH ? image : null
}

/** A short stable key: listing URLs (slug plus filters) can pass Topo's 1 KiB cap on keys. */
export function resultKey(url: string): string {
  let hash = 5381
  for (let index = 0; index < url.length; index++) {
    hash = ((hash << 5) + hash + url.charCodeAt(index)) >>> 0
  }
  return `${url.match(/MLMU?-?\d+/)?.[0] ?? 'ml'}-${hash.toString(36)}`
}

function money(value: number | null): string {
  return value === null ? 'sin precio' : `$${value.toLocaleString('es-MX')}`
}

async function search(product: Product): Promise<void> {
  await runAction('search', async () => {
    const found = await plugin.request('catalog.searchReplacement', {
      id: product.id,
      query: read(query)
    })
    set(results, { productId: product.id, candidates: found.candidates })
    return found
  })
}

/** Generates the referral, checks it opens the product, and writes the link and its price. */
function choose(product: Product, candidate: SearchCandidate): Promise<void> {
  return runAction('replace', () =>
    plugin.request('catalog.replaceLink', { id: product.id, url: candidate.url })
  )
}

/** The replacement already generated for this product: what its referral link will open. */
function ChosenReplacement({ product }: { product: Product }) {
  const { proposal } = product
  if (!proposal?.url) {
    return null
  }
  return (
    <Stack gap="xs">
      <Text weight="semibold">Reemplazo propuesto</Text>
      <Row gap="sm" align="start">
        {shown(proposal.image) ? (
          <Image
            src={shown(proposal.image) ?? ''}
            alt={proposal.title ?? 'Producto de reemplazo'}
            size="md"
            rounded
          />
        ) : null}
        <Stack gap="xs">
          <Text>{proposal.title ?? 'Sin título'}</Text>
          <Text muted size="xs">
            {proposal.url}
          </Text>
        </Stack>
      </Row>
    </Stack>
  )
}

/** Finds the product again in MercadoLibre's search and turns the chosen result into a referral. */
export function RepairSearch({ product }: { product: Product }) {
  const working = read(busy) !== null
  const current = read(results)
  const candidates = current && current.productId === read(selectedId) ? current.candidates : []
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        Busca el producto en MercadoLibre y elige el correcto: «Usar este» genera su referido,
        comprueba que abra el producto y guarda en la base el link nuevo y su precio.
      </Text>
      <Row gap="xs">
        <Input
          label="Buscar en MercadoLibre"
          labelHidden
          type="search"
          placeholder={`${product.brand} ${product.name}`}
          value={read(query)}
          onChange={(value) => set(query, value)}
          onSubmit={() => void search(product)}
        />
        <Button icon="search" disabled={working} onPress={() => search(product)}>
          Buscar reemplazo
        </Button>
      </Row>
      <ChosenReplacement product={product} />
      {candidates.map((candidate) => (
        <Row key={resultKey(candidate.url)} gap="sm" align="center">
          {shown(candidate.image) ? (
            <Image src={shown(candidate.image) ?? ''} alt={candidate.title} size="xs" rounded />
          ) : null}
          <Stack gap="none">
            <Text truncate>{candidate.title}</Text>
            {sizeNote(product.name, product.quantity, candidate.title) ? (
              <Text tone="warning" size="xs">
                {`Otro tamaño: ${sizeNote(product.name, product.quantity, candidate.title)}`}
              </Text>
            ) : null}
            <Text muted size="xs">
              {`${money(candidate.price)}${candidate.seller ? ` · ${candidate.seller}` : ''}`}
            </Text>
          </Stack>
          <Button
            size="sm"
            variant="outline"
            tooltip="Genera el referido, comprueba que abra este producto y guarda el link y el precio en la base."
            disabled={working || candidate.url === product.proposal?.url}
            onPress={() => choose(product, candidate)}
          >
            Usar este
          </Button>
        </Row>
      ))}
    </Stack>
  )
}
