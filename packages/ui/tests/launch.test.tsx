import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Launch } from '../src/screens/Launch/Launch'
import { COLUMN_COUNT, COLUMNS, jitter, toneOf } from '../src/screens/Launch/light'
import { AT, behindAt, lightAt, markAt, SET, spring } from '../src/screens/Launch/timeline'

/*
 * The launch: the light it rises in, when each part moves, and the window
 * it opens onto, inert until it does.
 */

describe('the light', () => {
  it('stands highest in the middle, in cobalt there, and warm at the edges', () => {
    expect(COLUMNS).toHaveLength(COLUMN_COUNT)
    const middle = COLUMNS[Math.floor(COLUMN_COUNT / 2)]!
    const edge = COLUMNS[0]!
    expect(middle.d).toBe(0)
    expect(edge.d).toBe(1)
    expect(middle.height).toBeGreaterThan(edge.height * 2)
    expect(middle.width).toBeGreaterThan(edge.width)
    expect(toneOf(0)[0]).toBe('#2b3bff')
    expect(middle.background).toContain('#2b3bff')
    expect(edge.background).toContain(toneOf(1)[0])
    expect(toneOf(1)[0]).not.toBe(toneOf(0.5)[0])
  })

  it('is uneven the same way every time', () => {
    expect(jitter(3)).toBe(jitter(3))
    for (let i = 0; i < COLUMN_COUNT; i++) {
      expect(jitter(i)).toBeGreaterThanOrEqual(0)
      expect(jitter(i)).toBeLessThan(1)
    }
  })
})

describe('when each part of the launch moves', () => {
  it('springs from rest to its end, past it only when it is let swing', () => {
    expect(spring(0, 0.5, 0.8)).toBe(0)
    expect(spring(-10, 0.5, 0.8)).toBe(0)
    expect(spring(3000, 0.5, 0.8)).toBeCloseTo(1, 4)
    const swung = Array.from({ length: 60 }, (_, i) => spring(i * 20, 0.5, 0.5))
    expect(Math.max(...swung)).toBeGreaterThan(1)
    const settled = Array.from({ length: 60 }, (_, i) => spring(i * 20, 0.5, 1))
    expect(Math.max(...settled)).toBeLessThanOrEqual(1)
  })

  it('starts with no light and no mark', () => {
    const light = lightAt(0, null)
    expect(light.columns.every((column) => column.height === 0)).toBe(true)
    expect(light.reach).toBe(0)
    const mark = markAt(0, null, light.reach)
    expect(mark.shown).toBe(0)
    expect(mark.clear).toBe(0)
    expect(mark.point).toBe(0)
    expect(mark.bloom).toBe(0)
    expect(mark.drop).toBeCloseTo(0.09)
  })

  it('has the light up and the mark clear of it, in ink with its foot lit and its point all but set, by the time it may open', () => {
    const light = lightAt(AT.set, null)
    expect(light.reach).toBeGreaterThan(0.9)
    expect(light.strength).toBe(1)
    const middle = light.columns[Math.floor(COLUMN_COUNT / 2)]!
    expect(middle.height).toBeGreaterThan(0.5)
    const mark = markAt(AT.set, null, light.reach)
    expect(mark.shown).toBe(1)
    expect(mark.drop).toBeLessThan(0.005)
    expect(mark.blur).toBeLessThan(0.5)
    expect(mark.clear).toBeGreaterThan(0.95)
    expect(mark.lit).toBeGreaterThan(0.8)
    expect(mark.rim).toBeGreaterThan(0.8)
    expect(mark.point).toBeGreaterThan(0.9)
    expect(mark.bloom).toBeGreaterThan(0.35)
  })

  it('sinks the light from the edges in, takes the mark into a blur, and raises what it opens onto into place', () => {
    const open = 2000
    const early = lightAt(open + 100, open)
    expect(early.columns[0]!.height).toBeLessThan(lightAt(open + 100, null).columns[0]!.height)
    const sunk = lightAt(open + AT.open.spread + AT.open.sink, open)
    expect(sunk.columns.every((column) => column.height === 0)).toBe(true)
    expect(sunk.reach).toBe(0)
    expect(lightAt(open + AT.open.fade.start + AT.open.fade.length, open).strength).toBe(0)
    const gone = markAt(open + AT.open.mark.start + AT.open.mark.length, open, 0)
    expect(gone.shown).toBe(0)
    expect(gone.up).toBe(10)
    expect(gone.blur).toBeGreaterThan(10)
    expect(behindAt(0)).toEqual({ rise: 28, blur: 8, scale: 0.985, strength: 0 })
    const settled = behindAt(AT.through)
    expect(settled.strength).toBe(1)
    expect(settled.rise).toBeCloseTo(0, 1)
    expect(settled.blur).toBeLessThan(0.05)
    expect(settled.scale).toBeCloseTo(1, 3)
  })

  it('brings the point out of the light in the bore without a bounce: it never grows past its size', () => {
    const points = Array.from({ length: 200 }, (_, i) => markAt(i * 10, null, 1).point)
    expect(Math.max(...points)).toBeLessThanOrEqual(1)
    const before = markAt(AT.point.start, null, 1)
    expect(before.point).toBe(0)
    expect(before.bloom).toBeGreaterThan(0)
    expect(markAt(AT.gather.start + AT.gather.length, null, 1).focus).toBeLessThan(before.focus)
  })

  it('has the mark set, in ink and with its point, when it opens at once', () => {
    expect(SET).toMatchObject({ shown: 1, blur: 0, clear: 1, point: 1, lit: 0, rim: 0 })
  })
})

describe('the launch', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('draws what it opens onto under it, hidden and inert, and opens once the mark is up and what is behind is ready', () => {
    const onDone = vi.fn()
    const { rerender, container } = render(
      <Launch ready={false} onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    expect(container.querySelector('[inert]')).not.toBeNull()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(AT.set + 1000))
    // Up, but what is behind isn't ready: it holds, the light standing.
    expect(onDone).not.toHaveBeenCalled()
    const behind = container.querySelector<HTMLElement>('[inert]')!
    expect(behind.style.opacity).toBe('')
    rerender(
      <Launch ready onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    act(() => void vi.advanceTimersByTime(400))
    expect(Number(behind.style.opacity)).toBeGreaterThan(0)
    act(() => void vi.advanceTimersByTime(AT.through))
    expect(onDone).toHaveBeenCalledOnce()
    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Behind' })).toBeTruthy()
  })

  it('skips to the mark set on a click', () => {
    const onDone = vi.fn()
    const { container } = render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(100))
    act(() => void container.querySelector('[aria-hidden="true"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    act(() => void vi.advanceTimersByTime(AT.through + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('skips on a key too', () => {
    const onDone = vi.fn()
    render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(100))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => void vi.advanceTimersByTime(AT.through + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('opens at once, with the mark set and a fade, when asked to be quick', () => {
    const onDone = vi.fn()
    render(<Launch ready quick onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(AT.quick.hold + AT.quick.fade + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('opens at once where motion is reduced', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList)
    const onDone = vi.fn()
    render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(AT.quick.hold + AT.quick.fade + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
