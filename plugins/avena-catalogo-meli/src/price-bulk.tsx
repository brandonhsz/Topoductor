import { atom, Button, Callout, plugin, read, Row, set, Stack, Text } from 'orca'
import { busy, progress, runAction, view } from './panel-state'
import type { BulkScope } from './protocol'

const confirming = atom<'applicable' | 'allPrices' | null>(null)

async function apply(scope: Extract<BulkScope, 'applicable' | 'allPrices'>): Promise<void> {
  set(confirming, null)
  await runAction('bulk', async () =>
    plugin.request('catalog.applyPrices', { ids: await plugin.request('catalog.ids', { scope }) })
  )
}

/** Writes ML prices in bulk: only the safe changes, or every new price after a warning. */
export function PriceBulk() {
  const current = read(view)
  const safe = current?.applicable ?? 0
  const all = current?.withNewPrice ?? 0
  const risky = Math.max(
    0,
    all - (current?.counts.precio_cambio ?? 0) - (current?.counts.sin_precio_base ?? 0)
  )
  const working = read(busy) !== null || read(progress)?.running === true
  const asking = read(confirming)
  if (all === 0 && safe === 0) {
    return null
  }
  if (asking) {
    const count = asking === 'allPrices' ? all : safe
    return (
      <Callout
        tone={asking === 'allPrices' ? 'warning' : 'neutral'}
        title={`¿Aplicar ${count} precios?`}
      >
        <Stack gap="xs">
          {asking === 'allPrices' && risky > 0 ? (
            <Text>
              Incluye {risky} productos que piden revisión (saltos mayores a 50%, identidad dudosa o
              link compartido): su precio de MercadoLibre podría ser de otro producto.
            </Text>
          ) : null}
          <Row gap="xs">
            <Button tone="accent" icon="check" disabled={working} onPress={() => apply(asking)}>
              Confirmar {count} precios
            </Button>
            <Button variant="ghost" onPress={() => set(confirming, null)}>
              Cancelar
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  }
  return (
    <Row gap="xs" wrap>
      {safe > 0 ? (
        <Button
          variant="outline"
          icon="upload"
          disabled={working}
          tooltip="Solo «Cambio de precio» y «Sin precio guardado»: los que no necesitan revisión."
          onPress={() => set(confirming, 'applicable')}
        >
          Aplicar {safe} cambios de precio seguros
        </Button>
      ) : null}
      {all > 0 ? (
        <Button
          variant="outline"
          icon="upload"
          disabled={working}
          tooltip="Todo producto cuyo precio en MercadoLibre es distinto del guardado, también los que piden revisión."
          onPress={() => set(confirming, 'allPrices')}
        >
          {`Aplicar precios de ML a todos (${all})`}
        </Button>
      ) : null}
    </Row>
  )
}
