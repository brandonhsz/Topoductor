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

test('repeating every 3 hours runs at the next slot from the start time', () => {
  // Slots at 00:00, 03:00 … 21:00.
  assert.equal(
    nextRunAt([0, 1, 2, 3, 4, 5, 6], '00:00', at(2026, 11, 19, 10, 20), 3),
    at(2026, 11, 19, 12)
  )
  assert.equal(
    nextRunAt([0, 1, 2, 3, 4, 5, 6], '00:00', at(2026, 11, 19, 12), 3),
    at(2026, 11, 19, 15)
  )
  // After the last slot of the day, the first one of the next.
  assert.equal(
    nextRunAt([0, 1, 2, 3, 4, 5, 6], '00:00', at(2026, 11, 19, 22), 3),
    at(2026, 11, 20, 0)
  )
  // The start time sets the grid: 01:30 → 04:30, 07:30 …
  assert.equal(nextRunAt([4], '01:30', at(2026, 11, 19, 5), 3), at(2026, 11, 19, 7, 30))
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Todos los días')
})
