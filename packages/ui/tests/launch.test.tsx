import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { arrive, Launch } from '../src/screens/Launch/Launch'
import { COLUMN_COUNT, COLUMNS, drawColumn, drawGrain, jitter, PICTURE, toneOf } from '../src/screens/Launch/light'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { LOGO_BORE, LOGO_SECTION } from '../src/foundations/Logo/Logo'
import { BORE, BORE_RADIUS, CORNERS, DOTS, FACE_RADIUS, halftone, inSection, PARTICLES, POINT_RADIUS } from '../src/screens/Launch/halftone'
import { arrivalOf, AT, dotAt, lightAt, particleAt, pointAt, SETTLED, spring, springEasing } from '../src/screens/Launch/timeline'

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
    expect(middle.tones[0]).toBe('#2b3bff')
    expect(edge.tones).toEqual(toneOf(1))
    expect(toneOf(1)[0]).not.toBe(toneOf(0.5)[0])
  })

  it('draws each column once, soft, rounded at the top and past the bottom, and grain as faint specks', () => {
    const calls: Array<string> = []
    const gradient = { addColorStop: (at: number, colour: string) => void calls.push(`stop ${at} ${colour}`) }
    const context = new Proxy(
      { filter: '', fillStyle: '' as unknown, createLinearGradient: () => gradient },
      {
        get: (target, name) =>
          name in target
            ? target[name as keyof typeof target]
            : (...args: Array<unknown>) => void calls.push(`${String(name)} ${args.join(' ')}`),
      },
    ) as unknown as CanvasRenderingContext2D
    drawColumn(context, COLUMNS[Math.floor(COLUMN_COUNT / 2)]!)
    expect(context.filter).toBe(`blur(${PICTURE.blur}px)`)
    expect(calls).toContain('stop 0 #2b3bff')
    expect(calls.some((call) => call.startsWith('ellipse'))).toBe(true)
    expect(
      calls.some((call) => call.startsWith(`moveTo ${(PICTURE.width - PICTURE.column) / 2} ${PICTURE.height + PICTURE.blur * 3}`)),
    ).toBe(true)
    expect(calls.at(-1)).toBe('fill ')

    const data = new Uint8ClampedArray(4 * 4 * 4)
    const put = vi.fn()
    let n = 0
    drawGrain({ createImageData: () => ({ data }), putImageData: put } as unknown as CanvasRenderingContext2D, 4, () =>
      n++ % 2 === 0 ? 0.2 : 0.9,
    )
    expect(put).toHaveBeenCalledOnce()
    expect(data[0]).toBe(0)
    expect(data[3]).toBeLessThanOrEqual(22)
  })

  it('stands on cobalt as tokens.css has it, and on the window’s own --live when given one', () => {
    const tokens = readFileSync(join(import.meta.dirname, '../src/styles/tokens.css'), 'utf8')
    expect(tokens).toContain(`--live: ${toneOf(0)[0]};`)
    const stops: Array<string> = []
    const context = new Proxy(
      { createLinearGradient: () => ({ addColorStop: (_: number, colour: string) => void stops.push(colour) }) },
      { get: (target, name) => (name in target ? target[name as keyof typeof target] : () => undefined) },
    ) as unknown as CanvasRenderingContext2D
    drawColumn(context, COLUMNS[Math.floor(COLUMN_COUNT / 2)]!, '#123456')
    drawColumn(context, COLUMNS[0]!, '#123456')
    expect(stops[0]).toBe('#123456')
    expect(stops[4]).toBe(toneOf(1)[0])
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
    expect(DOTS.every((dot) => dotAt(dot, 0, null) === null)).toBe(true)
    expect(PARTICLES.every((_, i) => particleAt(i, 0) === null)).toBe(true)
    expect(pointAt(0, null)).toBeNull()
  })

  it('raises the dots out of the light below, the base first, and has every one in place, with the point grown, a moment before it may open', () => {
    const base = DOTS.reduce((a, b) => (b.down > a.down ? b : a))
    const tip = DOTS.reduce((a, b) => (b.down < a.down ? b : a))
    const early = AT.dots.start + AT.dots.jitter + 60
    const rising = dotAt(base, early, null)
    expect(rising).not.toBeNull()
    expect(rising!.y).toBeGreaterThan(base.y)
    expect(rising!.r).toBeLessThan(base.r)
    expect(dotAt(tip, AT.dots.start + 40, null)).toBeNull()
    // Set and still a while before it may open, so the mark can be made out.
    const held = AT.set - 200
    for (const dot of DOTS) {
      const at = dotAt(dot, held, null)!
      expect(at.alpha).toBe(1)
      // Within a tenth of a unit: under a pixel at the launch's size.
      expect(Math.abs(at.x - dot.x)).toBeLessThan(0.1)
      expect(Math.abs(at.y - dot.y)).toBeLessThan(0.1)
    }
    expect(pointAt(held, null)).toEqual({ x: BORE.x, y: BORE.y, r: POINT_RADIUS, alpha: 1 })
  })

  it('closes the particles in on the bore one after another, and grows the point as they arrive', () => {
    const { particles } = AT
    const first = particleAt(0, particles.start + particles.length / 2)!
    const far = Math.hypot(first.x - BORE.x, first.y - BORE.y)
    const later = particleAt(0, particles.start + particles.length * 0.9)!
    expect(Math.hypot(later.x - BORE.x, later.y - BORE.y)).toBeLessThan(far)
    expect(particleAt(0, particles.start + particles.length)).toBeNull()
    expect(particleAt(PARTICLES.length - 1, particles.start + particles.length / 2)).toBeNull()
    expect(particleAt(PARTICLES.length, particles.start + 200)).toBeNull()
    const growing = pointAt(AT.point.start + AT.point.length / 2, null)!
    expect(growing.r).toBeCloseTo(POINT_RADIUS / 2)
  })

  it('sinks the light from the edges in and lets the dots fall back into it, the base first', () => {
    const open = 2000
    const early = lightAt(open + 100, open)
    expect(early.columns[0]!.height).toBeLessThan(lightAt(open + 100, null).columns[0]!.height)
    const sunk = lightAt(open + AT.open.spread + AT.open.sink, open)
    expect(sunk.columns.every((column) => column.height === 0)).toBe(true)
    expect(lightAt(open + AT.open.fade.start + AT.open.fade.length, open).strength).toBe(0)
    const base = DOTS.reduce((a, b) => (b.down > a.down ? b : a))
    const tip = DOTS.reduce((a, b) => (b.down < a.down ? b : a))
    const falling = open + AT.open.fall.length / 2
    expect(dotAt(base, falling, open)!.y).toBeGreaterThan(dotAt(tip, falling, open)!.y - tip.y + base.y)
    const gone = open + AT.open.fall.spread + AT.open.fall.length
    expect(DOTS.every((dot) => dotAt(dot, gone, open) === null)).toBe(true)
    expect(pointAt(gone, open)!.alpha).toBe(0)
    // The veil is gone by the time it goes.
    expect(AT.through).toBeGreaterThanOrEqual(AT.open.fade.start + AT.open.fade.length)
    expect(AT.through).toBeGreaterThanOrEqual(AT.open.paper.start + AT.open.paper.length)
  })

  it('has what it opens onto arrive top to bottom, then across, each on a spring the compositor can play', () => {
    expect(arrivalOf(0, 0)).toBe(AT.open.arrive.start)
    expect(arrivalOf(0.5, 0)).toBeGreaterThan(arrivalOf(0.1, 0))
    expect(arrivalOf(0.1, 0.8)).toBeGreaterThan(arrivalOf(0.1, 0))
    expect(arrivalOf(2, 2)).toBe(AT.open.arrive.start + AT.open.arrive.down + AT.open.arrive.across)
    const { easing, duration } = springEasing(0.62, 0.8)
    expect(easing).toMatch(/^linear\(0, /)
    expect(easing).toMatch(/, 1\)$/)
    const values = easing.slice('linear('.length, -1).split(', ').map(Number)
    expect(Math.max(...values)).toBeGreaterThan(1)
    expect(duration).toBeGreaterThan(500)
    expect(duration).toBeLessThan(1200)
  })

  it('has the mark set at once, every dot in place and the point grown, when it opens at once', () => {
    expect(spring(SETTLED, 0.5, 0.5)).toBe(1)
    expect(DOTS.every((dot) => dotAt(dot, SETTLED, null)?.alpha === 1)).toBe(true)
    expect(pointAt(SETTLED, null)?.r).toBe(POINT_RADIUS)
  })
})

describe('the halftone', () => {
  it('is a halftone of the mark Logo draws', () => {
    const path =
      CORNERS.map((c, i) => (i % 2 === 1 ? `A${FACE_RADIUS} ${FACE_RADIUS} 0 0 0 ` : i === 0 ? 'M' : 'L') + `${c.x} ${c.y}`).join('') + 'Z'
    expect(path).toBe(LOGO_SECTION)
    expect(LOGO_BORE.startsWith(`M${BORE.x - BORE_RADIUS} ${BORE.y}a${BORE_RADIUS} ${BORE_RADIUS} `)).toBe(true)
  })

  it('knows the section: in it below the bore and in the tips, not in the bore, the hollows or beyond the corners', () => {
    expect(inSection(12, 16.8)).toBe(true)
    expect(inSection(12, 6.5)).toBe(true)
    expect(inSection(18.8, 18.6)).toBe(true)
    expect(inSection(14.2, 13.2)).toBe(true)
    expect(inSection(12, 14.4)).toBe(false)
    expect(inSection(14.8, 12.6)).toBe(false)
    // The base is hollowed too, up to about 17.3 at its middle.
    expect(inSection(12, 17.5)).toBe(false)
    expect(inSection(12, 19.6)).toBe(false)
    expect(inSection(21, 19)).toBe(false)
  })

  it('puts dots only in the section, heavier toward the base, the same every time', () => {
    expect(DOTS.length).toBeGreaterThan(120)
    expect(DOTS.every((dot) => inSection(dot.x, dot.y))).toBe(true)
    const base = DOTS.filter((dot) => dot.down > 0.85)
    const tip = DOTS.filter((dot) => dot.down < 0.2)
    const mean = (dots: typeof DOTS) => dots.reduce((sum, dot) => sum + dot.r, 0) / dots.length
    expect(mean(base)).toBeGreaterThan(mean(tip))
    expect(halftone()).toEqual(DOTS)
    expect(halftone(0.25).length).toBeGreaterThan(DOTS.length * 3)
  })
})

describe('the launch', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('draws what it opens onto under its veil, inert, and opens once the mark is up and what is behind is ready', () => {
    const onDone = vi.fn()
    const { rerender, container } = render(
      <Launch ready={false} onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    expect(container.querySelector('[inert]')).not.toBeNull()
    expect(container.querySelector('[aria-hidden="true"] canvas')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(AT.set + 1000))
    // Up, but what is behind isn't ready: it holds, the light standing.
    expect(onDone).not.toHaveBeenCalled()
    // Drawn all along, under the veil: nothing to paint for the first time as it opens.
    const behind = container.querySelector<HTMLElement>('[inert]')!
    expect(behind.getAttribute('style')).toBeNull()
    rerender(
      <Launch ready onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    act(() => void vi.advanceTimersByTime(AT.through + AT.settle + 100))
    expect(onDone).toHaveBeenCalledOnce()
    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.getByRole('button', { name: 'Behind' })).toBeTruthy()
  })

  it('has the pieces of what it opens onto arrive, later the further down they sit, and leaves those below the window', () => {
    const animate = vi.fn()
    const at =
      (top: number, left = 0) =>
      () =>
        ({ top, left, height: 40, width: 200, right: left + 200, bottom: top + 40, x: left, y: top }) as DOMRect
    const within = document.createElement('div')
    within.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1000, height: 800 }) as DOMRect
    within.innerHTML = '<header data-arrive></header><ul data-arrive-each><li></li><li></li><li></li></ul><p>not marked</p>'
    const [header, first, second, below] = within.querySelectorAll<HTMLElement>('header, li')
    header!.getBoundingClientRect = at(10)
    first!.getBoundingClientRect = at(100)
    second!.getBoundingClientRect = at(400, 600)
    below!.getBoundingClientRect = at(900)
    for (const piece of [header, first, second, below]) piece!.animate = animate
    arrive(within)
    // Two animations each, the move and the fade, for the three that can be seen.
    expect(animate).toHaveBeenCalledTimes(6)
    const delays = animate.mock.calls.filter((_, i) => i % 2 === 0).map(([, options]) => (options as KeyframeAnimationOptions).delay)
    expect(delays).toEqual([arrivalOf(10 / 800, 0), arrivalOf(100 / 800, 0), arrivalOf(400 / 800, 0.6)])
    expect((animate.mock.calls[0]![1] as KeyframeAnimationOptions).fill).toBe('backwards')
    expect((animate.mock.calls[0]![1] as KeyframeAnimationOptions).easing).toMatch(/^linear\(/)
  })

  it('draws the mark on its canvas in cobalt: a dot for each of the halftone’s, once they are up, and the point', () => {
    const arcs: Array<number> = []
    let frameArcs = 0
    // The light's columns and grain draw on canvases too: everything else they ask of it does nothing.
    const own = {
      setTransform: () => {
        arcs.push(frameArcs)
        frameArcs = 0
      },
      arc: () => void frameArcs++,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      fillStyle: '' as unknown,
      globalAlpha: 1,
      filter: '',
    }
    const context = new Proxy(own, { get: (target, name) => (name in target ? target[name as keyof typeof own] : () => undefined) })
    const drawing = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext'])
    const picture = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,')
    try {
      const { container } = render(<Launch ready={false} />)
      act(() => void vi.advanceTimersByTime(AT.set + 200))
      const canvas = container.querySelector<HTMLCanvasElement>('[aria-hidden="true"] > canvas')!
      // Placed about the mark, at its smallest in a window with no size: 22 grid units across at 4.5 px each.
      expect(canvas.style.width).toBe(`${22 * 4.5}px`)
      expect(own.fillStyle).toBe('#2b3bff')
      // Set: every dot and the point; on the way, the point's particles too.
      expect(arcs.at(-1)).toBe(DOTS.length + 1)
      expect(Math.max(...arcs)).toBeGreaterThan(DOTS.length + 1)
    } finally {
      drawing.mockRestore()
      picture.mockRestore()
    }
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

  it('isn’t skipped by a modifier alone, as on the way to ⌘Tab', () => {
    const onDone = vi.fn()
    render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(100))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' })))
    act(() => void vi.advanceTimersByTime(AT.through + 100))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('lets what is behind be used as soon as it starts to arrive, the veil only decoration then', () => {
    const onDone = vi.fn()
    const { container } = render(
      <Launch ready onDone={onDone}>
        <button type="button">Behind</button>
      </Launch>,
    )
    act(() => void vi.advanceTimersByTime(AT.set + AT.settle + 50))
    expect(onDone).not.toHaveBeenCalled()
    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')?.className).toMatch(/through/)
  })

  it('opens at once, with the mark set and a fade, when asked to be quick', () => {
    const onDone = vi.fn()
    render(<Launch ready quick onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(AT.quick.hold + AT.settle + AT.quick.fade + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('opens at once where motion is reduced', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList)
    const onDone = vi.fn()
    render(<Launch ready onDone={onDone} />)
    act(() => void vi.advanceTimersByTime(AT.quick.hold + AT.settle + AT.quick.fade + 100))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
