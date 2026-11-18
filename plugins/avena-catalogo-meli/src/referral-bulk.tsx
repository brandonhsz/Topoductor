import { Button, Callout, plugin, read, Row, set, Spinner, Stack, Progress, Text } from 'orca'
import {
  busy,
  confirmingReferrals,
  progress,
  referralProgress,
  repairProgress,
  runAction,
  view
} from './panel-state'

async function saveAll(): Promise<void> {
  set(confirmingReferrals, false)
  await runAction('referrals', async () =>
    plugin.request('catalog.applyProposals', {
      ids: await plugin.request('catalog.ids', { scope: 'pendingReferrals' })
    })
  )
}

/** Generates referrals for every direct link, then saves the ones that open on their product. */
export function ReferralBulk() {
  const direct = read(view)?.direct ?? 0
  const pending = read(view)?.pendingReferrals ?? 0
  const broken = read(view)?.counts.roto ?? 0
  const status = read(referralProgress)
  const repairs = read(repairProgress)
  const running = status?.running === true || repairs?.running === true
  const working = running || read(busy) !== null || read(progress)?.running === true
  if (direct === 0 && broken === 0 && pending === 0) {
    return null
  }
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap>
        {broken > 0 ? (
          <Button
            icon="search"
            variant="outline"
            disabled={working}
            tooltip="Busca cada producto con link roto en MercadoLibre y propone el primer resultado con su misma marca y nombre. Revísalos antes de guardar."
            onPress={() =>
              runAction('repairs', () => plugin.request('catalog.proposeReplacements'))
            }
          >
            Buscar reemplazos ({broken} rotos)
          </Button>
        ) : null}
        <Button
          icon="link"
          variant="outline"
          disabled={working || direct === 0}
          tooltip="Pide a MercadoLibre un link de referido para cada producto con link directo. Quedan como propuesta hasta guardarlos."
          onPress={() => runAction('generate', () => plugin.request('catalog.generateReferrals'))}
        >
          Generar referidos ({direct} sin referido)
        </Button>
        {pending > 0 ? (
          read(confirmingReferrals) ? (
            <>
              <Button tone="accent" icon="check" disabled={working} onPress={saveAll}>
                Confirmar {pending} referidos
              </Button>
              <Button variant="ghost" onPress={() => set(confirmingReferrals, false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button
              icon="upload"
              disabled={working}
              tooltip="Guarda en la base los referidos generados que sí abren su producto."
              onPress={() => set(confirmingReferrals, true)}
            >
              Guardar {pending} referidos generados
            </Button>
          )
        ) : null}
      </Row>
      {repairs?.running ? (
        <Progress
          label={`Buscando reemplazos ${repairs.searched}/${repairs.total}`}
          value={(100 * repairs.searched) / repairs.total}
        />
      ) : repairs?.error ? (
        <Callout tone="danger" title="La búsqueda se detuvo">
          <Text>{repairs.error}</Text>
        </Callout>
      ) : repairs ? (
        <Text muted size="xs">
          Se propusieron {repairs.proposed} reemplazos para {repairs.total} links rotos. Revisa cada
          uno en su detalle antes de guardar.
        </Text>
      ) : null}
      {status?.running ? (
        <Row gap="xs">
          <Spinner label="Generando referidos" labelHidden />
          <Text muted size="xs">
            Generando referidos para {status.total} productos…
          </Text>
        </Row>
      ) : status?.error ? (
        <Callout tone="danger" title="La generación se detuvo">
          <Text>{status.error}</Text>
        </Callout>
      ) : status ? (
        <Text muted size="xs">
          Se generaron {status.generated} de {status.total} referidos. Los rechazados muestran su
          motivo en el detalle de cada producto.
        </Text>
      ) : null}
    </Stack>
  )
}
