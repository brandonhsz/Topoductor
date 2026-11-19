// "Tareas programadas": what runs on its own, when, and how the last runs went.
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  IconButton,
  Input,
  plugin,
  read,
  RadioGroup,
  Row,
  Select,
  set,
  Stack,
  Switch,
  Table,
  Text
} from 'orca'
import { busy, runAction } from './panel-state'
import { describeDays, WEEKDAY_LABELS } from './schedule-time'
import { TASK_LABELS, type Schedule, type TaskKind } from './schedule-types'
import { scheduleDraft, schedulesState } from './schedules-state'

const KINDS = Object.keys(TASK_LABELS).filter((kind): kind is TaskKind => kind in TASK_LABELS)

const when = (at: number | null) => (at ? new Date(at).toLocaleString('es-MX') : '—')

function save(schedule: Schedule, enabled: boolean): Promise<void> {
  return runAction('schedule', () =>
    plugin.request('schedules.save', {
      id: schedule.id,
      kind: schedule.kind,
      days: schedule.days,
      time: schedule.time,
      enabled,
      mode: schedule.mode
    })
  )
}

function ScheduleRow({ schedule }: { schedule: Schedule }) {
  const working = read(busy) !== null
  return (
    <Row justify="between" gap="xs" wrap>
      <Stack gap="xs">
        <Row gap="xs">
          <Text>{TASK_LABELS[schedule.kind]}</Text>
          {schedule.kind === 'processOrders' ? (
            <Badge tone={schedule.mode === 'real' ? 'danger' : 'neutral'}>
              {schedule.mode === 'real' ? 'Compra real' : 'Prueba'}
            </Badge>
          ) : null}
        </Row>
        <Text muted size="xs">
          {`${describeDays(schedule.days)} a las ${schedule.time} · próxima: ${schedule.enabled ? when(schedule.nextRunAt) : 'en pausa'}`}
        </Text>
      </Stack>
      <Row gap="xs">
        <Switch
          label="Activa"
          checked={schedule.enabled}
          disabled={working}
          onChange={(enabled) => void save(schedule, enabled)}
        />
        <IconButton
          icon="play"
          label="Correr ahora"
          disabled={working}
          onPress={() =>
            runAction('schedule', () =>
              plugin.request('schedules.runNow', { kind: schedule.kind, mode: schedule.mode })
            )
          }
        />
        <IconButton
          icon="delete"
          label="Eliminar"
          disabled={working}
          onPress={() =>
            runAction('schedule', () => plugin.request('schedules.remove', { id: schedule.id }))
          }
        />
      </Row>
    </Row>
  )
}

function NewSchedule() {
  const draft = read(scheduleDraft)
  const toggleDay = (day: number, on: boolean) =>
    set(scheduleDraft, {
      ...draft,
      days: on ? [...draft.days, day] : draft.days.filter((d) => d !== day)
    })
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap>
        <Select
          label="Tarea"
          value={draft.kind}
          options={KINDS.map((kind) => ({ value: kind, label: TASK_LABELS[kind] }))}
          onChange={(value) => {
            const kind = KINDS.find((candidate) => candidate === value)
            if (kind) {
              set(scheduleDraft, { ...draft, kind })
            }
          }}
        />
        <Input
          label="Hora (HH:MM)"
          value={draft.time}
          onChange={(time) => set(scheduleDraft, { ...draft, time })}
        />
      </Row>
      <Row gap="xs" wrap>
        {WEEKDAY_LABELS.map((label, day) => (
          <Checkbox
            key={label}
            label={label}
            checked={draft.days.includes(day)}
            onChange={(on) => toggleDay(day, on)}
          />
        ))}
      </Row>
      {draft.kind === 'processOrders' ? (
        <RadioGroup
          label="Modo de compra"
          orientation="horizontal"
          value={draft.mode}
          options={[
            { value: 'prueba', label: 'Prueba', description: 'Llega a la revisión y no compra.' },
            {
              value: 'real',
              label: 'Compra real',
              description: 'Confirma si el total cabe en el tope y el domicilio coincide.'
            }
          ]}
          onChange={(mode) =>
            set(scheduleDraft, { ...draft, mode: mode === 'real' ? 'real' : 'prueba' })
          }
        />
      ) : null}
      <Row>
        <Button
          icon="add"
          disabled={read(busy) !== null}
          onPress={() =>
            runAction('schedule', () =>
              plugin.request('schedules.save', { ...draft, enabled: true })
            )
          }
        >
          Programar
        </Button>
      </Row>
    </Stack>
  )
}

const RUN_COLUMNS = [
  { key: 'tarea', label: 'Tarea' },
  { key: 'inicio', label: 'Inicio', hideBelow: 'sm' as const },
  { key: 'resultado', label: 'Resultado' }
]

function QueueStatus() {
  const queue = read(schedulesState)?.queue
  if (!queue) {
    return null
  }
  const parts = [
    queue.running ? `En proceso: ${queue.running}` : null,
    queue.elsewhere ? `En proceso en otro worker: ${queue.elsewhere}` : null,
    queue.waiting.length > 0 ? `En espera: ${queue.waiting.join(' → ')}` : null
  ].filter((part): part is string => part !== null)
  return (
    <Row gap="xs" wrap>
      <Badge tone={parts.length > 0 ? 'accent' : 'neutral'}>Cola de MercadoLibre</Badge>
      <Text size="xs" muted={parts.length === 0}>
        {parts.length > 0
          ? parts.join(' · ')
          : 'Libre: el siguiente flujo empieza en cuanto llegue.'}
      </Text>
    </Row>
  )
}

export function SchedulesPanel() {
  const state = read(schedulesState)
  const schedules = state?.schedules ?? []
  return (
    <Stack gap="sm">
      <QueueStatus />
      <Callout tone="neutral">
        <Text size="xs">
          Las tareas corren dentro de Topo mientras el plugin esté activo (indicador «Catálogo ML»
          en la barra de estado). Si Topo estaba cerrado a la hora, corren al abrirlo.
        </Text>
      </Callout>
      {schedules.length === 0 ? (
        <Text muted>Aún no hay tareas programadas.</Text>
      ) : (
        schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)
      )}
      <NewSchedule />
      {state && state.runs.length > 0 ? (
        <Table
          label="Historial de tareas"
          columns={RUN_COLUMNS}
          maxHeight="sm"
          rows={state.runs.map((run) => ({
            key: String(run.id),
            cells: {
              tarea: TASK_LABELS[run.kind],
              inicio: when(run.startedAt),
              resultado:
                run.finishedAt === null ? 'Corriendo…' : `${run.ok ? '✓' : '✗'} ${run.summary}`
            }
          }))}
        />
      ) : null}
    </Stack>
  )
}
