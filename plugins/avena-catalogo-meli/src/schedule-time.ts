// When a scheduled task runs next: on the chosen weekdays at a local time, like an alarm.

/** 0 Sunday … 6 Saturday, as `Date#getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

/** Minutes of the day a task runs at: `time` alone, or every `everyHours` on its grid. */
function slots(
  time: { hour: number; minute: number },
  everyHours: number | null | undefined
): number[] {
  const first = time.hour * 60 + time.minute
  if (!everyHours || everyHours <= 0) {
    return [first]
  }
  const step = everyHours * 60
  const out: number[] = []
  for (let minute = first % step; minute < 24 * 60; minute += step) {
    out.push(minute)
  }
  return out
}

/**
 * The first run strictly after `after` (epoch ms), or null when no day is chosen. With
 * `everyHours`, the task repeats on a grid that goes through `time` (00:00 every 3 h → 00, 03 …).
 */
export function nextRunAt(
  days: readonly number[],
  time: string,
  after: number,
  everyHours?: number | null
): number | null {
  const at = parseTime(time)
  if (!at || days.length === 0) {
    return null
  }
  const start = new Date(after)
  for (let offset = 0; offset <= 7; offset++) {
    for (const minute of slots(at, everyHours)) {
      const candidate = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + offset,
        Math.floor(minute / 60),
        minute % 60,
        0,
        0
      )
      if (candidate.getTime() > after && days.includes(candidate.getDay())) {
        return candidate.getTime()
      }
    }
  }
  return null
}

export function describeDays(days: readonly number[]): string {
  if (days.length === 7) {
    return 'Todos los días'
  }
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) {
    return 'Lunes a viernes'
  }
  return [...days]
    .sort()
    .map((day) => WEEKDAY_LABELS[day] ?? '?')
    .join(', ')
}
