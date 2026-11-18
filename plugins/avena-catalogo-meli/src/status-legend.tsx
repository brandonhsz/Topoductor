import { Button, read, Row } from 'orca'
import { STATUS_DESCRIPTIONS, STATUS_LABELS } from './catalog-status'
import { changeFilter, filter, REVIEW_STATUSES, view } from './panel-state'
import type { ProductStatus } from './protocol'

const ORDER: readonly ProductStatus[] = [...REVIEW_STATUSES, 'ok', 'sin_revisar']

/** One chip per status present: hovering explains it, pressing filters the table to it. */
export function StatusLegend() {
  const counts = read(view)?.counts ?? {}
  const active = read(filter)
  return (
    <Row gap="xs" wrap>
      {ORDER.map((status) => {
        const count = counts[status] ?? 0
        return count > 0 ? (
          <Button
            key={status}
            size="xs"
            variant={active === status ? 'solid' : 'ghost'}
            tooltip={STATUS_DESCRIPTIONS[status]}
            onPress={() => changeFilter(active === status ? 'revisar' : status)}
          >
            {`${STATUS_LABELS[status]} (${count})`}
          </Button>
        ) : null
      })}
    </Row>
  )
}
