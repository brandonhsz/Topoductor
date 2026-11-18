// @vitest-environment happy-dom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  FAN_CURVE_LIMITS,
  type FanCurve,
  type FanCurvePoint,
  type ThermalReading
} from '../../../../shared/fan-control-contract'
import { FanCurveEditor } from './FanCurveEditor'

const THERMAL: ThermalReading = {
  chipC: 80,
  palmrestC: 33,
  blendC: 65,
  palmrestAvailable: true
}

// T2's proposed initial smart curve; source blend is the plan's default.
const CURVE: FanCurve = {
  source: 'blend',
  points: [
    { tempC: 60, percent: 0 },
    { tempC: 70, percent: 35 },
    { tempC: 80, percent: 70 },
    { tempC: 88, percent: 100 }
  ]
}

const PLOT_RECT = { left: 0, top: 0, width: 400, height: 200 }

function Controlled({
  initial,
  thermal = THERMAL,
  onChange
}: {
  initial: FanCurve
  thermal?: ThermalReading
  onChange: (curve: FanCurve) => void
}): React.JSX.Element {
  const [curve, setCurve] = useState(initial)
  return (
    <FanCurveEditor
      curve={curve}
      thermal={thermal}
      onChange={(next) => {
        onChange(next)
        setCurve(next)
      }}
    />
  )
}

function points(): HTMLElement[] {
  return screen.getAllByRole('slider', { name: /point/i })
}

type CurveChange = Mock<(curve: FanCurve) => void>

function curveChange(): CurveChange {
  return vi.fn<(curve: FanCurve) => void>()
}

function lastCurve(onChange: CurveChange): FanCurve {
  const call = onChange.mock.calls.at(-1)
  if (!call) {
    throw new Error('onChange was never called')
  }
  return call[0]
}

function expectValidCurve(curve: FanCurve): void {
  const { points: pts } = curve
  expect(pts.length).toBeGreaterThanOrEqual(FAN_CURVE_LIMITS.minPoints)
  expect(pts.length).toBeLessThanOrEqual(FAN_CURVE_LIMITS.maxPoints)
  pts.forEach((p: FanCurvePoint, i) => {
    expect(p.tempC).toBeGreaterThanOrEqual(FAN_CURVE_LIMITS.minTempC)
    expect(p.tempC).toBeLessThanOrEqual(FAN_CURVE_LIMITS.maxTempC)
    expect(p.percent).toBeGreaterThanOrEqual(FAN_CURVE_LIMITS.minPercent)
    expect(p.percent).toBeLessThanOrEqual(FAN_CURVE_LIMITS.maxPercent)
    if (i > 0) {
      expect(p.tempC).toBeGreaterThan(pts[i - 1].tempC)
      expect(p.percent).toBeGreaterThanOrEqual(pts[i - 1].percent)
    }
  })
}

function press(target: HTMLElement, key: string, times = 1): void {
  for (let i = 0; i < times; i++) {
    act(() => {
      fireEvent.keyDown(target, { key })
    })
  }
}

function drag(target: HTMLElement, clientX: number, clientY: number): void {
  const start = target.getBoundingClientRect()
  act(() => {
    fireEvent.pointerDown(target, {
      pointerId: 1,
      button: 0,
      clientX: start.left,
      clientY: start.top
    })
  })
  act(() => {
    fireEvent.pointerMove(target, { pointerId: 1, buttons: 1, clientX, clientY })
  })
  act(() => {
    fireEvent.pointerUp(target, { pointerId: 1, button: 0, clientX, clientY })
  })
}

beforeEach(() => {
  // happy-dom has no layout; the editor maps pointer positions through getBoundingClientRect.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...PLOT_RECT,
    x: PLOT_RECT.left,
    y: PLOT_RECT.top,
    right: PLOT_RECT.left + PLOT_RECT.width,
    bottom: PLOT_RECT.top + PLOT_RECT.height,
    toJSON: () => ({})
  } satisfies DOMRect)
  for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[method]) {
      Element.prototype[method] = () => {}
    }
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FanCurveEditor points', () => {
  it('renders one focusable point per curve point', () => {
    render(<FanCurveEditor curve={CURVE} thermal={THERMAL} onChange={vi.fn()} />)
    const handles = points()
    expect(handles).toHaveLength(CURVE.points.length)
    for (const handle of handles) {
      expect(handle.getAttribute('tabindex')).toBe('0')
    }
  })

  it('moves a point with the arrow keys and reports a valid curve', () => {
    const onChange = curveChange()
    render(<Controlled initial={CURVE} onChange={onChange} />)
    press(points()[1], 'ArrowRight')
    let curve = lastCurve(onChange)
    expect(curve.points[1].tempC).toBeGreaterThan(70)
    expect(curve.points[1].percent).toBe(35)
    expect(curve.points.filter((_, i) => i !== 1)).toEqual(CURVE.points.filter((_, i) => i !== 1))
    expectValidCurve(curve)

    press(points()[1], 'ArrowUp')
    curve = lastCurve(onChange)
    expect(curve.points[1].percent).toBeGreaterThan(35)
    expect(curve.points[1].tempC).toBeGreaterThan(70)
    expectValidCurve(curve)

    press(points()[1], 'ArrowDown')
    expect(lastCurve(onChange).points[1].percent).toBeLessThan(curve.points[1].percent)
    press(points()[1], 'ArrowLeft')
    expect(lastCurve(onChange).points[1].tempC).toBeLessThan(curve.points[1].tempC)
  })

  it('keeps the source when a point moves', () => {
    const onChange = curveChange()
    render(<Controlled initial={{ ...CURVE, source: 'chip' }} onChange={onChange} />)
    press(points()[0], 'ArrowUp')
    expect(lastCurve(onChange).source).toBe('chip')
  })

  it('never lets a point cross its neighbour with the keyboard', () => {
    const onChange = curveChange()
    render(<Controlled initial={CURVE} onChange={onChange} />)
    press(points()[0], 'ArrowRight', 40)
    press(points()[2], 'ArrowDown', 120)
    for (const [curve] of onChange.mock.calls) {
      expectValidCurve(curve)
    }
    const curve = lastCurve(onChange)
    expect(curve.points[0].tempC).toBeLessThan(curve.points[1].tempC)
    expect(curve.points[2].percent).toBeGreaterThanOrEqual(curve.points[1].percent)
  })

  it('clamps points to the curve limits', () => {
    const onChange = curveChange()
    const edge: FanCurve = {
      source: 'blend',
      points: [
        { tempC: 22, percent: 3 },
        { tempC: 105, percent: 97 }
      ]
    }
    render(<Controlled initial={edge} onChange={onChange} />)
    press(points()[0], 'ArrowLeft', 30)
    press(points()[0], 'ArrowDown', 30)
    press(points()[1], 'ArrowRight', 30)
    press(points()[1], 'ArrowUp', 30)
    for (const [curve] of onChange.mock.calls) {
      expectValidCurve(curve)
    }
    const curve = lastCurve(onChange)
    expect(curve.points[0].tempC).toBe(FAN_CURVE_LIMITS.minTempC)
    expect(curve.points[0].percent).toBe(FAN_CURVE_LIMITS.minPercent)
    expect(curve.points[1].tempC).toBe(FAN_CURVE_LIMITS.maxTempC)
    expect(curve.points[1].percent).toBe(FAN_CURVE_LIMITS.maxPercent)
  })
})

describe('FanCurveEditor dragging', () => {
  it('drags a point toward hotter and faster', () => {
    const onChange = curveChange()
    render(<Controlled initial={CURVE} onChange={onChange} />)
    drag(points()[2], PLOT_RECT.width * 0.95, PLOT_RECT.height * 0.02)
    const curve = lastCurve(onChange)
    expect(curve.points[2].tempC).toBeGreaterThan(80)
    expect(curve.points[2].percent).toBeGreaterThan(70)
    expectValidCurve(curve)
  })

  it('stops a dragged point before it crosses the next one', () => {
    const onChange = curveChange()
    render(<Controlled initial={CURVE} onChange={onChange} />)
    drag(points()[0], PLOT_RECT.width, PLOT_RECT.height)
    const curve = lastCurve(onChange)
    expect(curve.points[0].tempC).toBeGreaterThan(60)
    expect(curve.points[0].tempC).toBeLessThan(curve.points[1].tempC)
    expectValidCurve(curve)
  })
})

describe('FanCurveEditor now marker', () => {
  it('marks where the Mac is now on the selected source', () => {
    const { rerender } = render(
      <FanCurveEditor curve={CURVE} thermal={THERMAL} onChange={vi.fn()} />
    )
    expect(screen.getByLabelText(/now/i).getAttribute('aria-label')).toMatch(/65/)
    rerender(
      <FanCurveEditor curve={{ ...CURVE, source: 'chip' }} thermal={THERMAL} onChange={vi.fn()} />
    )
    expect(screen.getByLabelText(/now/i).getAttribute('aria-label')).toMatch(/80/)
    rerender(
      <FanCurveEditor
        curve={{ ...CURVE, source: 'palmrest' }}
        thermal={THERMAL}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/now/i).getAttribute('aria-label')).toMatch(/33/)
  })

  it('hides the marker when the selected source has no reading', () => {
    render(
      <FanCurveEditor
        curve={CURVE}
        thermal={{ chipC: null, palmrestC: null, blendC: null, palmrestAvailable: false }}
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByLabelText(/now/i)).toBeNull()
  })
})

describe('FanCurveEditor source selector', () => {
  it('checks the current source and switches curve.source on click', () => {
    const onChange = vi.fn()
    render(<FanCurveEditor curve={CURVE} thermal={THERMAL} onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /blend/i }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /chip/i }).getAttribute('aria-checked')).toBe('false')
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /chip/i }))
    })
    expect(onChange).toHaveBeenCalledWith({ ...CURVE, source: 'chip' })
  })

  it('disables the palm-rest source when the Mac has no palm-rest sensor', () => {
    render(
      <FanCurveEditor
        curve={CURVE}
        thermal={{ chipC: 80, palmrestC: null, blendC: 80, palmrestAvailable: false }}
        onChange={vi.fn()}
      />
    )
    const palmrest = screen.getByRole('radio', { name: /palm rest/i })
    expect(
      palmrest.hasAttribute('disabled') || palmrest.getAttribute('aria-disabled') === 'true'
    ).toBe(true)
  })
})

describe('FanCurveEditor source selector on a chip-only Mac', () => {
  it('follows the chip and disables palm rest and blend', () => {
    render(
      <FanCurveEditor
        curve={CURVE}
        thermal={{ chipC: 80, palmrestC: null, blendC: 80, palmrestAvailable: false }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: /chip/i }).getAttribute('aria-checked')).toBe('true')
    for (const name of [/palm rest/i, /blend/i]) {
      const radio = screen.getByRole('radio', { name })
      expect(radio.getAttribute('aria-checked')).toBe('false')
      expect(radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true').toBe(
        true
      )
    }
  })
})

describe('FanCurveEditor learned curve', () => {
  it('overlays the learned smart curve only when one is given', () => {
    const { container, rerender } = render(
      <FanCurveEditor curve={CURVE} thermal={THERMAL} onChange={vi.fn()} />
    )
    expect(container.querySelector('[data-series="learned"]')).toBeNull()
    rerender(
      <FanCurveEditor
        curve={CURVE}
        thermal={THERMAL}
        learnedPoints={[
          { tempC: 55, percent: 10 },
          { tempC: 75, percent: 80 }
        ]}
        onChange={vi.fn()}
      />
    )
    expect(container.querySelector('[data-series="learned"]')).not.toBeNull()
  })
})
