import {
  Badge,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  Input,
  plugin,
  Progress,
  read,
  Row,
  Select,
  set,
  Stack,
  Table,
  Text,
  type PanelContext,
  type TableRow
} from 'orca'
import { STATUS_LABELS } from './catalog-status'
import { ConnectionForm } from './connection-form'
import {
  busy,
  changeFilter,
  changeSearch,
  changeSort,
  connection,
  filter,
  loadConnection,
  loadMore,
  loadView,
  notice,
  progress,
  referralProgress,
  refreshAll,
  repairProgress,
  REVIEW_STATUSES,
  runAction,
  search,
  selectedId,
  selectProduct,
  sort,
  view,
  type Filter
} from './panel-state'
import { PriceBulk } from './price-bulk'
import { money, ProductDetail } from './product-detail'
import { ReferralBulk } from './referral-bulk'
import { StatusLegend } from './status-legend'
import type { CatalogView, Product, ProductStatus } from './protocol'

const STATUS_ORDER: readonly ProductStatus[] = [...REVIEW_STATUSES, 'ok', 'sin_revisar']

const COLUMNS = [
  { key: 'producto', label: 'Producto', sortable: true },
  { key: 'estatus', label: 'Estatus', sortable: true, hideBelow: 'sm' as const },
  {
    key: 'guardado',
    label: 'Guardado',
    align: 'end' as const,
    sortable: true,
    hideBelow: 'md' as const
  },
  { key: 'ml', label: 'ML', align: 'end' as const, sortable: true },
  { key: 'dif', label: 'Dif.', align: 'end' as const, sortable: true, hideBelow: 'sm' as const }
]

function toRow(product: Product): TableRow {
  const { reading } = product
  return {
    key: product.id,
    cells: {
      producto: `${product.brand} · ${product.name}`,
      estatus:
        product.status === 'referido_rechazado' && product.proposal?.reason
          ? `Rechazado: ${product.proposal.reason}`
          : STATUS_LABELS[product.status],
      guardado: money(product.price),
      ml: reading ? (reading.ok ? money(reading.price) : 'roto') : '—',
      dif: product.diffPct === null ? '' : `${product.diffPct > 0 ? '+' : ''}${product.diffPct}%`
    }
  }
}

function filterOptions(current: CatalogView) {
  const count = (status: ProductStatus) => current.counts[status] ?? 0
  const review = REVIEW_STATUSES.reduce((sum, status) => sum + count(status), 0)
  return [
    { value: 'revisar', label: `Por revisar (${review})` },
    { value: 'todos', label: `Todos (${current.all})` },
    { value: 'con_referido', label: `Con link de referido (${current.withReferral})` },
    ...STATUS_ORDER.filter((status) => count(status) > 0).map((status) => ({
      value: status,
      label: `${STATUS_LABELS[status]} (${count(status)})`
    }))
  ]
}

function isFilter(value: string): value is Filter {
  return (
    value === 'revisar' ||
    value === 'todos' ||
    value === 'con_referido' ||
    STATUS_ORDER.some((status) => status === value)
  )
}

function selectedKeys(id: string | null): string[] {
  return id ? [id] : []
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('audit.progress', (payload) => set(progress, payload)),
    plugin.on('referrals.progress', (payload) => set(referralProgress, payload)),
    plugin.on('repairs.progress', (payload) => set(repairProgress, payload)),
    plugin.on('catalog.changed', () => void refreshAll())
  )
  void loadView()
  void loadConnection().catch(() => undefined)
}

function Toolbar() {
  const working = read(busy) !== null || read(progress)?.running === true
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap>
        <Button
          icon="refresh"
          disabled={working}
          onPress={() => runAction('sync', () => plugin.request('catalog.sync'))}
        >
          Sincronizar base
        </Button>
        <Button
          icon="play"
          disabled={working || (read(view)?.all ?? 0) === 0}
          onPress={() => runAction('audit', () => plugin.request('catalog.audit', {}))}
        >
          Leer precios en ML
        </Button>
      </Row>
    </Stack>
  )
}

function AuditStatus() {
  const current = read(progress)
  if (!current) {
    return null
  }
  if (current.running) {
    return (
      <Progress
        label={`Leyendo MercadoLibre ${current.done}/${current.total}`}
        value={(100 * current.done) / current.total}
      />
    )
  }
  return current.blocked ? (
    <Callout tone="danger" title="La lectura se detuvo">
      <Text>
        MercadoLibre pidió iniciar sesión o verificar la cuenta. Hazlo en el navegador de Topo y
        vuelve a leer: lo ya leído se conservó ({current.done}/{current.total}).
      </Text>
    </Callout>
  ) : (
    <Text muted size="xs">
      Lectura terminada: {current.done} links.
    </Text>
  )
}

export default function Panel() {
  const data = read(view)
  const status = read(connection)
  const message = read(notice)
  const missing = status !== null && (!status.mongo || !status.backend)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Catálogo MercadoLibre</Heading>
        <Badge tone="accent">{data?.all ?? 0} productos</Badge>
      </Row>
      {missing ? (
        <Callout tone="warning" title="Faltan conexiones">
          <ConnectionForm />
        </Callout>
      ) : null}
      <Toolbar />
      <PriceBulk />
      <ReferralBulk />
      <AuditStatus />
      {message ? (
        <Callout tone={message.ok ? 'success' : 'danger'}>
          <Text>{message.text}</Text>
        </Callout>
      ) : null}
      {data === null || data.all === 0 ? (
        <EmptyState
          icon="database"
          title="Sin catálogo cargado"
          description="Sincroniza la base para traer los productos del owner con link de MercadoLibre."
        />
      ) : (
        <Stack gap="sm">
          <StatusLegend />
          <Row gap="xs">
            <Select
              label="Filtro"
              labelHidden
              value={read(filter)}
              options={filterOptions(data)}
              onChange={(value) => {
                if (isFilter(value)) {
                  changeFilter(value)
                }
              }}
            />
            <Input
              label="Buscar"
              labelHidden
              type="search"
              placeholder="Marca o nombre"
              value={read(search)}
              onChange={changeSearch}
            />
          </Row>
          <Table
            label="Suplementos"
            columns={COLUMNS}
            rows={data.rows.map(toRow)}
            sort={read(sort)}
            onSortChange={changeSort}
            hasMore={data.rows.length < data.total}
            onLoadMore={loadMore}
            selectionMode="single"
            selected={selectedKeys(read(selectedId))}
            onSelectionChange={({ keys }) => selectProduct(keys[0] ?? null)}
            emptyText="Nada con este filtro."
            maxHeight="md"
          />
          {data.syncedAt ? (
            <Text muted size="xs">
              Base sincronizada {new Date(data.syncedAt).toLocaleString('es-MX')}
            </Text>
          ) : null}
        </Stack>
      )}
      <ProductDetail />
      {!missing ? (
        <Collapsible title="Conexiones" description="Mongo, backend y MercadoLibre">
          <ConnectionForm />
        </Collapsible>
      ) : null}
    </Stack>
  )
}
