// "Pedidos (prueba)": the mock queue that stands in for the backend's purchase orders.
import { Badge, Button, Card, IconButton, Input, plugin, read, Row, set, Stack, Text } from 'orca'
import { busy, runAction } from './panel-state'
import type { OrderAddress, OrderStatus, PurchaseOrder } from './schedule-types'
import {
  EMPTY_ADDRESS,
  orderDraft,
  parseCap,
  pickedNames,
  productMatches,
  productSearch,
  schedulesState,
  searchProducts
} from './schedules-state'

const STATUS: Record<
  OrderStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }
> = {
  pendiente: { label: 'Pendiente', tone: 'neutral' },
  en_proceso: { label: 'En proceso', tone: 'accent' },
  comprado: { label: 'Comprado', tone: 'success' },
  en_revision: { label: 'Listo para revisar', tone: 'warning' },
  detenido: { label: 'Detenido', tone: 'danger' }
}

const ADDRESS_FIELDS: readonly { key: keyof OrderAddress; label: string }[] = [
  { key: 'recipient', label: 'Nombre y apellido' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'street', label: 'Calle' },
  { key: 'number', label: 'Número exterior' },
  { key: 'interior', label: 'Interior (opcional)' },
  { key: 'colonia', label: 'Colonia' },
  { key: 'postalCode', label: 'Código postal' },
  { key: 'municipality', label: 'Municipio / alcaldía' },
  { key: 'state', label: 'Estado' },
  { key: 'references', label: 'Referencias (opcional)' }
]

function Order({ order }: { order: PurchaseOrder }) {
  const names = read(pickedNames)
  const status = STATUS[order.status]
  return (
    <Card title={`${order.address.recipient} · CP ${order.address.postalCode}`}>
      <Stack gap="xs">
        <Row gap="xs" justify="between">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Text muted size="xs">{`Tope $${order.cap.toLocaleString('es-MX')}`}</Text>
        </Row>
        {order.items.map((item) => {
          const result = order.results.find((r) => r.productId === item.productId)
          return (
            <Text key={item.productId} size="xs">
              {`${item.quantity} × ${names[item.productId] ?? item.productId}${result ? ` — ${result.message}` : ''}`}
            </Text>
          )
        })}
        {order.status === 'detenido' || order.status === 'en_revision' ? (
          <Row>
            <Button
              variant="outline"
              icon="refresh"
              disabled={read(busy) !== null}
              onPress={() =>
                runAction('order', () => plugin.request('orders.retry', { id: order.id }))
              }
            >
              Volver a pendiente
            </Button>
          </Row>
        ) : null}
      </Stack>
    </Card>
  )
}

function NewOrder() {
  const draft = read(orderDraft)
  const names = read(pickedNames)
  const setField = (key: keyof OrderAddress, value: string) =>
    set(orderDraft, { ...draft, address: { ...draft.address, [key]: value } })
  const add = (id: string, name: string) => {
    set(pickedNames, { ...names, [id]: name })
    if (!draft.items.some((item) => item.productId === id)) {
      set(orderDraft, { ...draft, items: [...draft.items, { productId: id, quantity: 1 }] })
    }
  }
  const quantity = (id: string, value: number) =>
    set(orderDraft, {
      ...draft,
      items: draft.items
        .map((item) => (item.productId === id ? { ...item, quantity: value } : item))
        .filter((item) => item.quantity > 0)
    })
  const cap = parseCap(draft.cap)
  return (
    <Stack gap="xs">
      <Input
        label="Agregar producto (con link de referido)"
        type="search"
        placeholder="Marca o nombre"
        value={read(productSearch)}
        onChange={(query) => void searchProducts(query)}
      />
      {read(productMatches).map((product) => (
        <Row key={product.id} justify="between" gap="xs">
          <Text size="xs">{`${product.brand} · ${product.name}`}</Text>
          <IconButton
            icon="add"
            label="Agregar"
            onPress={() => add(product.id, `${product.brand} · ${product.name}`)}
          />
        </Row>
      ))}
      {draft.items.map((item) => (
        <Row key={item.productId} justify="between" gap="xs">
          <Text>{`${item.quantity} × ${names[item.productId] ?? item.productId}`}</Text>
          <Row gap="xs">
            <IconButton
              icon="remove"
              label="Uno menos"
              onPress={() => quantity(item.productId, item.quantity - 1)}
            />
            <IconButton
              icon="add"
              label="Uno más"
              onPress={() => quantity(item.productId, item.quantity + 1)}
            />
          </Row>
        </Row>
      ))}
      {ADDRESS_FIELDS.map((field) => (
        <Input
          key={field.key}
          label={field.label}
          value={draft.address[field.key] ?? ''}
          onChange={(value) => setField(field.key, value)}
        />
      ))}
      <Input
        label="Tope total del pedido (MXN)"
        value={draft.cap}
        invalid={draft.cap !== '' && cap === null}
        onChange={(value) => set(orderDraft, { ...draft, cap: value })}
      />
      <Row>
        <Button
          icon="add"
          disabled={read(busy) !== null || draft.items.length === 0 || cap === null}
          onPress={() =>
            runAction('order', async () => {
              const result = await plugin.request('orders.createMock', {
                address: {
                  ...draft.address,
                  interior: draft.address.interior?.trim() || null,
                  references: draft.address.references?.trim() || null
                },
                items: draft.items,
                cap: cap ?? 0
              })
              if (result.ok) {
                set(orderDraft, { address: EMPTY_ADDRESS, items: [], cap: '' })
              }
              return result
            })
          }
        >
          Agregar pedido de prueba
        </Button>
      </Row>
    </Stack>
  )
}

export function OrdersPanel() {
  const orders = read(schedulesState)?.orders ?? []
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        Cola de prueba mientras el backend no entrega pedidos: la tarea «Procesar pedidos de compra»
        toma los pendientes. Nunca se capturan datos bancarios; en modo real, la cuenta de
        MercadoLibre necesita un medio de pago ya guardado.
      </Text>
      {orders.length === 0 ? (
        <Text muted>Sin pedidos.</Text>
      ) : (
        orders.map((order) => <Order key={order.id} order={order} />)
      )}
      <NewOrder />
    </Stack>
  )
}
