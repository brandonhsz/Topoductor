// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FanReading, ThermalSample } from '../../../../shared/fan-control-contract'
import { FanThermalChart } from './FanThermalChart'

const FANS: FanReading[] = [
  { index: 0, rpm: 2510, minRpm: 2317, maxRpm: 6800 },
  { index: 1, rpm: 2510, minRpm: 2317, maxRpm: 6800 }
]

const T0 = 1_700_000_000_000

function sample(
  offsetS: number,
  chipC: number,
  palmrestC: number | null,
  fanRpm: number[]
): ThermalSample {
  const palmrestAvailable = palmrestC !== null
  const blendC = palmrestC === null ? chipC : 0.7 * chipC + 0.3 * palmrestC
  return { at: T0 + offsetS * 1000, chipC, palmrestC, blendC, palmrestAvailable, fanRpm }
}

const HISTORY: ThermalSample[] = [
  sample(0, 62, 32, [2320, 2510]),
  sample(30, 78, 32.4, [3100, 2510]),
  sample(60, 95, 32.9, [4200, 2510]),
  sample(90, 84, 33.1, [3600, 2510])
]

const CHIP_ONLY: ThermalSample[] = HISTORY.map((s) =>
  sample((s.at - T0) / 1000, s.chipC ?? 0, null, s.fanRpm)
)

function series(container: HTMLElement, name: string): Element | null {
  return container.querySelector(`[data-series="${name}"]`)
}

function geometry(element: Element | null): string {
  return element?.getAttribute('d') ?? element?.getAttribute('points') ?? ''
}

function fanSeries(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-series^="fan-"]')).map(
    (el) => el.getAttribute('data-series') ?? ''
  )
}

afterEach(cleanup)

describe('FanThermalChart temperature lines', () => {
  it('draws palm rest, chip and blend as three overlaid lines', () => {
    const { container } = render(
      <FanThermalChart history={HISTORY} fans={FANS} palmrestAvailable />
    )
    for (const name of ['palmrest', 'chip', 'blend']) {
      expect(geometry(series(container, name))).not.toBe('')
    }
    expect(geometry(series(container, 'chip'))).not.toBe(geometry(series(container, 'palmrest')))
    expect(geometry(series(container, 'blend'))).not.toBe(geometry(series(container, 'chip')))
  })

  it('labels each line in a legend and exposes the chart as an image', () => {
    render(<FanThermalChart history={HISTORY} fans={FANS} palmrestAvailable />)
    expect(screen.getByRole('img', { name: /temperature/i })).toBeTruthy()
    expect(screen.getByText(/^palm rest$/i)).toBeTruthy()
    expect(screen.getByText(/^chip$/i)).toBeTruthy()
    expect(screen.getByText(/^blend$/i)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('hides the palm-rest line and says it uses the chip only when the Mac has no palm-rest sensor', () => {
    const { container } = render(
      <FanThermalChart history={CHIP_ONLY} fans={FANS} palmrestAvailable={false} />
    )
    expect(series(container, 'palmrest')).toBeNull()
    expect(screen.queryByText(/^palm rest$/i)).toBeNull()
    expect(geometry(series(container, 'chip'))).not.toBe('')
    expect(screen.getByRole('note').textContent).toMatch(/chip/i)
  })
})

describe('FanThermalChart fan speeds', () => {
  it('draws one RPM series per fan from the sampled speeds', () => {
    const { container } = render(
      <FanThermalChart history={HISTORY} fans={FANS} palmrestAvailable />
    )
    expect(fanSeries(container).sort()).toEqual(['fan-0', 'fan-1'])
    expect(geometry(series(container, 'fan-0'))).not.toBe('')
    // fan 0 ramps while fan 1 stays flat, so the two lines cannot share geometry.
    expect(geometry(series(container, 'fan-0'))).not.toBe(geometry(series(container, 'fan-1')))
    expect(screen.getByText(/^fan 1$/i)).toBeTruthy()
    expect(screen.getByText(/^fan 2$/i)).toBeTruthy()
  })

  it('draws a single RPM series on a one-fan Mac', () => {
    const oneFan = HISTORY.map((s) => ({ ...s, fanRpm: [s.fanRpm[0]] }))
    const { container } = render(
      <FanThermalChart history={oneFan} fans={[FANS[0]]} palmrestAvailable />
    )
    expect(fanSeries(container)).toEqual(['fan-0'])
    expect(screen.queryByText(/^fan 2$/i)).toBeNull()
  })

  it('draws temperatures only on a fanless Mac', () => {
    const fanless = HISTORY.map((s) => ({ ...s, fanRpm: [] }))
    const { container } = render(<FanThermalChart history={fanless} fans={[]} palmrestAvailable />)
    expect(fanSeries(container)).toEqual([])
    expect(geometry(series(container, 'blend'))).not.toBe('')
  })
})

describe('FanThermalChart axes and chip-only Macs', () => {
  it("caps the RPM axis at the fans' maximum and keeps overshooting readings inside the plot", () => {
    const overshoot = HISTORY.map((s) => ({ ...s, fanRpm: [6843, 6843] }))
    const { container } = render(
      <FanThermalChart history={overshoot} fans={FANS} palmrestAvailable />
    )
    expect(screen.queryByText('6,843')).toBeNull()
    expect(screen.getByText('6,800')).toBeTruthy()
    const ys = geometry(series(container, 'fan-0'))
      .split(/[ML]/)
      .filter(Boolean)
      .map((point) => Number(point.trim().split(' ')[1]))
    const plotTop = Math.min(
      ...Array.from(container.querySelectorAll('line')).map((line) =>
        Number(line.getAttribute('y1'))
      )
    )
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(plotTop)
  })

  it('labels the time axis with the span the samples really cover', () => {
    const short = [sample(0, 62, 32, [2320, 2510]), sample(20, 64, 32, [2320, 2510])]
    render(<FanThermalChart history={short} fans={FANS} palmrestAvailable />)
    expect(screen.queryByText(/min ago/i)).toBeNull()
    expect(screen.getByText('20 s ago')).toBeTruthy()
  })

  it('shows only the chip on a Mac without a palm-rest sensor, with no blend line or legend', () => {
    const { container } = render(
      <FanThermalChart history={CHIP_ONLY} fans={FANS} palmrestAvailable={false} />
    )
    expect(series(container, 'blend')).toBeNull()
    expect(screen.queryByText(/^blend$/i)).toBeNull()
    expect(screen.getByText(/^chip$/i)).toBeTruthy()
  })
})
