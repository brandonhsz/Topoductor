import { assert, test } from 'orca/testing'
import { describeDays, nextRunAt, parseTime } from './schedule-time'

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

test('runs later the same day when the time has not passed', () => {
  // Wednesday 18 Nov 2026, 08:00 → 09:30 that day.
  assert.equal(nextRunAt([3], '09:30', at(2026, 11, 18, 8)), at(2026, 11, 18, 9, 30))
})

test('moves to the next chosen weekday once the time has passed', () => {
  // Wednesday 10:00, chosen Mon and Fri → Friday 20 at 09:30.
  assert.equal(nextRunAt([1, 5], '09:30', at(2026, 11, 18, 10)), at(2026, 11, 20, 9, 30))
  // Same weekday, a week later.
  assert.equal(nextRunAt([3], '09:30', at(2026, 11, 18, 10)), at(2026, 11, 25, 9, 30))
})

test('refuses bad times and empty days', () => {
  assert.equal(parseTime('25:00'), null)
  assert.equal(nextRunAt([], '09:00', 0), null)
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Lunes a viernes')
})
