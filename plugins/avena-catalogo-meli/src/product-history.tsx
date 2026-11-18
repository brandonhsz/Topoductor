import { Collapsible, read, Table, Text } from 'orca'
import { history } from './panel-state'

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`
}

function when(at: number): string {
  return new Date(at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

/** Every price reading and referral attempt the local database kept for the selected product. */
export function ProductHistory() {
  const current = read(history)
  if (!current) {
    return null
  }
  const { readings, attempts } = current
  return (
    <>
      <Collapsible
        title={`Historial de precios (${readings.length})`}
        description="Cada lectura en MercadoLibre, la más reciente primero"
      >
        {readings.length === 0 ? (
          <Text muted size="xs">
            Aún no hay lecturas guardadas de este link.
          </Text>
        ) : (
          <Table
            label="Historial de precios"
            columns={[
              { key: 'fecha', label: 'Fecha' },
              { key: 'precio', label: 'Precio', align: 'end' },
              { key: 'lista', label: 'Lista', align: 'end', hideBelow: 'sm' },
              { key: 'vendedor', label: 'Vendedor', hideBelow: 'md' }
            ]}
            rows={readings.map((reading, index) => ({
              key: String(index),
              cells: {
                fecha: when(reading.checkedAt),
                precio: reading.ok ? money(reading.price) : 'roto',
                lista: money(reading.listPrice),
                vendedor: reading.seller ?? '—'
              }
            }))}
            maxHeight="sm"
          />
        )}
      </Collapsible>
      {attempts.length > 0 ? (
        <Collapsible
          title={`Intentos de referido (${attempts.length})`}
          description="Cada vez que se pidió su referido a MercadoLibre"
        >
          <Table
            label="Intentos de referido"
            columns={[
              { key: 'fecha', label: 'Fecha' },
              { key: 'resultado', label: 'Resultado' }
            ]}
            rows={attempts.map((attempt, index) => ({
              key: String(index),
              cells: {
                fecha: when(attempt.createdAt),
                resultado: attempt.referral ?? `Rechazado: ${attempt.reason ?? 'sin motivo'}`
              }
            }))}
            maxHeight="sm"
          />
        </Collapsible>
      ) : null}
    </>
  )
}
