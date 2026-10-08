import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOGO_SECTION } from '../src/foundations/Logo/Logo'
import { BORE, circle, FACE_RADIUS, FACES, faceCircle, scalePath, SIDES, sideLine, ticks, turned } from '../src/screens/Launch/geometry'
import { Launch } from '../src/screens/Launch/Launch'
import { AT, drawingAt, INK_REACH, throughAt } from '../src/screens/Launch/timeline'

/*
 * The launch: its drawing follows from the mark, each part's timing, and the
 * window it opens onto, inert until it does.
 */

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('the drawing the launch builds the mark from', () => {
  it('starts from the mark’s own corners', () => {
    for (const [from, to] of FACES) {
      expect(LOGO_SECTION).toContain(`${from.x} ${from.y}`)
      expect(LOGO_SECTION).toContain(`${to.x} ${to.y}`)
    }
  })

  it('hollows each face with a circle through its two corners, standing beyond the side, away from the bore', () => {
    for (const side of SIDES) {
      expect(distance(side.centre, side.from)).toBeCloseTo(FACE_RADIUS, 6)
      expect(distance(side.centre, side.to)).toBeCloseTo(FACE_RADIUS, 6)
      expect(distance(side.centre, BORE)).toBeGreaterThan(distance(side.middle, BORE))
      expect(Math.hypot(side.out.x, side.out.y)).toBeCloseTo(1)
      expect(side.out.x * (side.middle.x - BORE.x) + side.out.y * (side.middle.y - BORE.y)).toBeGreaterThan(0)
      expect(faceCircle(side)).toMatch(/^M[\d.]+ [\d.]+A15\.36 15\.36 0 1 0 /)
    }
  })

  it('turns a side about the bore, keeping its length and its distance from it', () => {
    const side = SIDES[0]!
    expect(turned(side, 0)).toBe(side)
    const round = turned(side, Math.PI * 2)
    expect(round.from.x).toBeCloseTo(side.from.x)
    expect(round.from.y).toBeCloseTo(side.from.y)
    const quarter = turned(side, Math.PI / 2)
    expect(distance(quarter.from, quarter.to)).toBeCloseTo(distance(side.from, side.to))
    expect(distance(quarter.middle, BORE)).toBeCloseTo(distance(side.middle, BORE))
    expect(sideLine(side, 2)).toMatch(/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/)
  })

  it('marks a scale every half unit, a fifth longer and standing out, shown only as far as it has run', () => {
    const marks = ticks(10)
    expect(marks).toHaveLength(41)
    expect(marks.filter((mark) => mark.major).map((mark) => mark.at)).toEqual([-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10])
    expect(marks.find((mark) => mark.at === 0)?.length).toBeGreaterThan(marks.find((mark) => mark.at === 2.5)?.length ?? 0)
    const side = SIDES[1]!
    expect(scalePath(side, marks, 0, true).match(/M/g)).toHaveLength(1)
    expect(scalePath(side, marks, 0, false)).toBe('')
    expect(scalePath(side, marks, 1, false).match(/M/g)).toHaveLength(4)
    expect(circle(BORE, 0)).toBe('')
    expect(circle(BORE, 1)).toMatch(/Z$/)
  })
})

describe('when each part of the launch moves', () => {
  it('starts with nothing drawn, and has all of it drawn by the time the camera may go in', () => {
    const start = drawingAt(0, 50)
    expect(start.sides).toEqual([0, 0, 0])
    expect(start.circles).toEqual([0, 0, 0])
    expect(start.outline).toBe(0)
    expect(start.ink).toBe(0)
    expect(start.point).toBe(0)
    expect(start.settled).toBe(0)
    expect(start.camera).toBeCloseTo(1.1)
    const end = drawingAt(AT.drawn, 50)
    expect(end.sides).toEqual([50, 50, 50])
    expect(end.swings.map(Math.abs)).toEqual([0, 0, 0])
    expect(end.circles).toEqual([1, 1, 1])
    expect(end.outline).toBe(1)
    expect(end.ink).toBe(INK_REACH)
    expect(end.bore).toBeCloseTo(1)
    expect(end.point).toBeCloseTo(1)
    expect(end.settled).toBe(1)
    expect(end.camera).toBe(1)
    expect(end.construction).toBeCloseTo(0.45)
  })

  it('swings the sides in as an iris closes, and sets the point with a ring that fades', () => {
    const early = drawingAt(AT.sides.start + 100, 50)
    expect(early.swings.every((swing) => swing < 0)).toBe(true)
    const setting = drawingAt(AT.point.start + 200, 50)
    expect(setting.ring.strength).toBeGreaterThan(0)
    expect(setting.ring.radius).toBeGreaterThan(1)
    expect(drawingAt(AT.point.start + 2000, 50).ring.strength).toBe(0)
  })

  it('goes in through the bore until it is past the window, and brings what is behind into focus', () => {
    const start = throughAt(0, 40)
    expect(start.zoom).toBe(1)
    expect(start.behind).toEqual({ scale: 1.06, blur: 10, strength: 0.55 })
    expect(start.gone).toBe(false)
    expect(throughAt(0.3, 40).point).toBe(0)
    const open = throughAt(0.7, 40)
    expect(open.zoom).toBeCloseTo(40)
    expect(open.gone).toBe(true)
    expect(throughAt(1, 40).behind).toEqual({ scale: 1, blur: 0, strength: 1 })
  })
})

describe('the launch', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] }))
  afterEach(() => void vi.useRealTimers())

  it('draws what it opens onto under it, inert, and opens once the mark is drawn and what is behind is ready', () => {
    const onDone = vi.fn()
    const { rerender, container } = render(
      <Launch ready={false} onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    expect(container.querySelector('[inert]')).not.toBeNull()
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(AT.drawn + 1000))
    // Drawn, but what is behind isn't ready: it holds.
    expect(onDone).not.toHaveBeenCalled()
    rerender(
      <Launch ready onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    act(() => void vi.advanceTimersByTime(AT.through + 100))
    expect(onDone).toHaveBeenCalledOnce()
    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Behind' })).toBeTruthy()
  })

  it('skips to the end of the drawing on a click', () => {
    const onDone = vi.fn()
    const { container } = render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(100))
    act(() => void container.querySelector('svg')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    act(() => void vi.advanceTimersByTime(AT.through + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('opens at once, with the mark set and a fade, when asked to be quick', () => {
    const onDone = vi.fn()
    render(<Launch ready quick onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(AT.quick.hold + AT.quick.fade + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
