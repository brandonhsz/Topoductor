// When a scheduled task runs next: on the chosen weekdays at a local time, like an alarm.

/** 0 Sunday … 6 Saturday, as `Date#getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

/** The first run strictly after `after` (epoch ms), or null when no day is chosen. */
export function nextRunAt(days: readonly number[], time: string, after: number): number | null {
  const at = parseTime(time)
  if (!at || days.length === 0) {
    return null
  }
  const start = new Date(after)
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset,
      at.hour,
      at.minute,
      0,
      0
    )
    if (candidate.getTime() > after && days.includes(candidate.getDay())) {
      return candidate.getTime()
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
