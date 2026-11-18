import {
  Button,
  Callout,
  Card,
  Input,
  KeyValue,
  plugin,
  read,
  Row,
  set,
  shell,
  Stack,
  Switch,
  Text
} from 'orca'
import { STATUS_DESCRIPTIONS, STATUS_LABELS } from './catalog-status'
import { formatSize, parseSizes, sizeNote } from './presentation'
import { busy, changeFilter, progress, runAction, selected, urlDraft } from './panel-state'
import { ProductHistory } from './product-history'
import { RepairSearch } from './repair-search'
import type { Product } from './protocol'

export function money(value: number | null | undefined): string {
  return typeof value === 'number'
    ? `$${value.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`
    : '—'
}

function facts(product: Product) {
  const { reading } = product
  return [
    { label: 'Owner', value: product.owner || '—' },
    { label: 'Link', value: product.productURL },
    {
      label: 'Tipo de link',
      value: product.linkKind === 'referido' ? 'Referido (comisiona)' : 'Directo (sin comisión)'
    },
    { label: 'Precio guardado', value: money(product.price) },
    {
      label: 'Precio en ML',
      value: reading?.ok ? money(reading.price) : reading ? 'Link roto' : 'Sin leer'
    },
    { label: 'Precio de lista ML', value: money(reading?.listPrice) },
    {
      label: 'Descuento',
      value: reading?.discountPercentage ? `${reading.discountPercentage}%` : '—'
    },
    { label: 'Diferencia', value: product.diffPct === null ? '—' : `${product.diffPct}%` },
    { label: 'Título en ML', value: reading?.title ?? '—' },
    { label: 'Vendedor ML', value: reading?.seller ?? '—' },
    { label: 'Id ML', value: reading?.mlItemId ?? product.mlItemId ?? '—' },
    { label: 'Con stock', value: product.hasStock === null ? '—' : product.hasStock ? 'Sí' : 'No' },
    { label: 'Margen', value: product.margin === null ? 'Sin margen' : `${product.margin}%` },
    {
      label: 'Presentación',
      value: [product.quantity, product.flavor].filter(Boolean).join(' · ') || '—'
    },
    {
      label: 'Presentación en ML',
      value: parseSizes(reading?.title).map(formatSize).join(' · ') || '—',
      tone: sizeNote(product.name, product.quantity, reading?.title ?? null)
        ? ('warning' as const)
        : undefined
    }
  ]
}

export function ProductDetail() {
  const product = read(selected)
  if (!product) {
    return null
  }
  const working = read(busy) !== null || read(progress)?.running === true
  const draft = read(urlDraft).trim()
  const { reading, proposal } = product
  const canApplyPrice = Boolean(reading?.ok && reading.price && reading.price !== product.price)
  return (
    <Card title={`${product.brand} · ${product.name}`} description={product.id}>
      <Stack gap="sm">
        {product.sharedCount > 1 ? (
          <Callout tone="warning" title="Link compartido">
            <Text>
              {product.sharedCount} productos usan este mismo link: confirma a cuál apunta antes de
              cargar su precio.
            </Text>
          </Callout>
        ) : null}
        <Row gap="xs" align="center">
          <Text muted size="sm">
            Estatus
          </Text>
          <Button
            size="xs"
            variant="outline"
            icon="info"
            tooltip={STATUS_DESCRIPTIONS[product.status]}
            onPress={() => changeFilter(product.status)}
          >
            {STATUS_LABELS[product.status]}
          </Button>
        </Row>
        <KeyValue items={facts(product)} />
        <Row gap="xs" wrap>
          <Button
            icon="refresh"
            disabled={working || product.linkKind !== 'referido'}
            onPress={() =>
              runAction('read', () => plugin.request('catalog.audit', { ids: [product.id] }))
            }
          >
            Leer precio
          </Button>
          <Button
            icon="check"
            tone="accent"
            disabled={working || !canApplyPrice}
            onPress={() =>
              runAction('apply', () => plugin.request('catalog.applyPrices', { ids: [product.id] }))
            }
          >
            Aplicar {money(reading?.price)}
          </Button>
          <Button
            icon="open-external"
            variant="ghost"
            onPress={() => void shell.openExternal(product.productURL)}
          >
            Abrir
          </Button>
        </Row>
        {product.status === 'roto' ||
        (product.status === 'referido_listo' && product.reading?.ok === false) ? (
          <Callout tone="warning" title="Link roto">
            <RepairSearch product={product} />
          </Callout>
        ) : null}
        <Input
          label="URL de MercadoLibre"
          placeholder={
            product.linkKind === 'directo'
              ? product.productURL
              : 'https://www.mercadolibre.com.mx/…'
          }
          value={read(urlDraft)}
          onChange={(value) => set(urlDraft, value)}
        />
        <Row gap="xs" wrap>
          <Button
            icon="link"
            disabled={working || (!draft && product.linkKind !== 'directo')}
            onPress={() =>
              runAction('referral', () =>
                plugin.request('catalog.generateReferral', {
                  id: product.id,
                  url: draft || undefined
                })
              )
            }
          >
            Generar referido
          </Button>
          <Button
            variant="outline"
            disabled={working || !draft}
            onPress={() =>
              runAction('url', () =>
                plugin.request('catalog.applyUrl', { id: product.id, url: draft })
              )
            }
          >
            Guardar URL tal cual
          </Button>
        </Row>
        {proposal?.url ? (
          <Callout tone="success" title="Referido generado">
            <Stack gap="xs">
              <Text>{proposal.url}</Text>
              {proposal.title ? (
                <Text muted size="xs">
                  Muestra: {proposal.title}
                </Text>
              ) : null}
              <Button
                icon="check"
                tone="accent"
                disabled={working || proposal.url === product.productURL}
                onPress={() =>
                  runAction('url', () =>
                    plugin.request('catalog.applyUrl', { id: product.id, url: proposal.url ?? '' })
                  )
                }
              >
                Guardar este link
              </Button>
            </Stack>
          </Callout>
        ) : proposal?.reason ? (
          <Callout tone="warning" title="No se generó el referido">
            <Text>{proposal.reason}</Text>
          </Callout>
        ) : null}
        <Switch
          label="Con stock"
          checked={product.hasStock === true}
          disabled={working}
          onChange={(hasStock) =>
            void runAction('stock', () =>
              plugin.request('catalog.setStock', { id: product.id, hasStock })
            )
          }
        />
        <ProductHistory />
      </Stack>
    </Card>
  )
}
