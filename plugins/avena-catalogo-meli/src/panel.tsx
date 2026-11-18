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
  applicable,
  busy,
  catalog,
  confirmingBulk,
  connection,
  filter,
  loadConnection,
  notice,
  products,
  progress,
  REVIEW_STATUSES,
  runAction,
  search,
  selectedId,
  sort,
  urlDraft,
  visible,
  type Filter
} from './panel-state'
import { money, ProductDetail } from './product-detail'
import type { Product, ProductStatus } from './protocol'

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
      estatus: STATUS_LABELS[product.status],
      guardado: money(product.price),
      ml: reading ? (reading.ok ? money(reading.price) : 'roto') : '—',
      dif: product.diffPct === null ? '' : `${product.diffPct > 0 ? '+' : ''}${product.diffPct}%`
    }
  }
}

function filterOptions(all: readonly Product[]) {
  const count = (status: ProductStatus) => all.filter((product) => product.status === status).length
  const review = all.filter((product) => REVIEW_STATUSES.includes(product.status)).length
  return [
    { value: 'revisar', label: `Por revisar (${review})` },
    { value: 'todos', label: `Todos (${all.length})` },
    {
      value: 'con_referido',
      label: `Con link de referido (${all.filter((product) => product.linkKind === 'referido').length})`
    },
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

function select(id: string | null): void {
  set(selectedId, id)
  set(urlDraft, '')
}

async function applyAll(): Promise<void> {
  set(confirmingBulk, false)
  await runAction('bulk', () =>
    plugin.request('catalog.applyPrices', { ids: read(applicable).map((product) => product.id) })
  )
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('audit.progress', (payload) => set(progress, payload)))
  void loadConnection().catch(() => undefined)
}

function Toolbar() {
  const working = read(busy) !== null || read(progress)?.running === true
  const pending = read(applicable).length
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
          disabled={working || read(products).length === 0}
          onPress={() => runAction('audit', () => plugin.request('catalog.audit', {}))}
        >
          Leer precios en ML
        </Button>
      </Row>
      {pending > 0 ? (
        read(confirmingBulk) ? (
          <Row gap="xs" wrap>
            <Button tone="accent" icon="check" disabled={working} onPress={applyAll}>
              Confirmar {pending} precios
            </Button>
            <Button variant="ghost" onPress={() => set(confirmingBulk, false)}>
              Cancelar
            </Button>
          </Row>
        ) : (
          <Button
            variant="outline"
            icon="upload"
            disabled={working}
            onPress={() => set(confirmingBulk, true)}
          >
            Aplicar {pending} cambios de precio seguros
          </Button>
        )
      ) : null}
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
  const data = read(catalog)
  const all = read(products)
  const status = read(connection)
  const message = read(notice)
  const missing = status !== null && (!status.mongo || !status.backend)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Catálogo MercadoLibre</Heading>
        <Badge tone="accent">{all.length} productos</Badge>
      </Row>
      {missing ? (
        <Callout tone="warning" title="Faltan conexiones">
          <ConnectionForm />
        </Callout>
      ) : null}
      <Toolbar />
      <AuditStatus />
      {message ? (
        <Callout tone={message.ok ? 'success' : 'danger'}>
          <Text>{message.text}</Text>
        </Callout>
      ) : null}
      {data === null || all.length === 0 ? (
        <EmptyState
          icon="database"
          title="Sin catálogo cargado"
          description="Sincroniza la base para traer los productos del owner con link de MercadoLibre."
        />
      ) : (
        <Stack gap="sm">
          <Row gap="xs">
            <Select
              label="Filtro"
              labelHidden
              value={read(filter)}
              options={filterOptions(all)}
              onChange={(value) => {
                if (isFilter(value)) {
                  set(filter, value)
                }
              }}
            />
            <Input
              label="Buscar"
              labelHidden
              type="search"
              placeholder="Marca o nombre"
              value={read(search)}
              onChange={(value) => set(search, value)}
            />
          </Row>
          <Table
            label="Suplementos"
            columns={COLUMNS}
            rows={read(visible).map(toRow)}
            sort={read(sort)}
            onSortChange={(next) => set(sort, next)}
            selectionMode="single"
            selected={selectedKeys(read(selectedId))}
            onSelectionChange={({ keys }) => select(keys[0] ?? null)}
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
