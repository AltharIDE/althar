import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { drawHalftone, HALFTONE_RISE, HalftoneMark } from '../src/foundations/HalftoneMark/HalftoneMark'
import { DOTS } from '../src/foundations/HalftoneMark/halftone'
import { COLUMN_COUNT, COLUMNS } from '../src/foundations/Light/columns'
import { driftOf, Light, LIGHT, vary } from '../src/foundations/Light/Light'
import { HomeRest } from '../src/home/HomeRest/HomeRest'

/*
 * The light a screen rests over, and the mark printed over it: what they ask
 * the compositor to run, and what they draw.
 */

interface Run {
  target: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  finished: Promise<void>
  effect: { getTiming: () => { iterations: number } }
}

/** Element.animate, recording what it is asked to run. */
function compositor() {
  const runs: Run[] = []
  const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const run: Run = {
      target: this,
      frames,
      options,
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      finished: Promise.resolve(),
      effect: { getTiming: () => ({ iterations: Number(options.iterations ?? 1) }) },
    }
    runs.push(run)
    return run as unknown as Animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return runs
}

const reduce = (on: boolean) =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query: string) =>
        ({ matches: on && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    )

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks()
  // Back to the setup's context, which draws nothing.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']
})

describe('the light', () => {
  let runs: Run[]
  beforeEach(() => {
    runs = compositor()
  })

  it('rises, then drifts on rhythms of its own, and sways', () => {
    render(<Light />)
    const columns = runs.filter((run) => run.target.tagName === 'CANVAS')
    const rises = columns.filter((run) => run.options.iterations === undefined)
    expect(rises).toHaveLength(COLUMN_COUNT)
    // The middle starts first.
    const middle = rises[Math.floor(COLUMN_COUNT / 2)]
    const edge = rises[0]
    expect(Number(middle?.options.delay)).toBeLessThan(Number(edge?.options.delay))
    expect(columns.filter((run) => run.options.iterations === Infinity)).toHaveLength(COLUMN_COUNT * 2)
    expect(runs.filter((run) => run.target.tagName === 'DIV' && run.options.iterations === Infinity)).toHaveLength(1)
  })

  it('only rises when told to stand still, and stands at once with motion reduced', () => {
    const { unmount } = render(<Light motion="still" />)
    expect(runs.every((run) => run.options.iterations === undefined)).toBe(true)
    unmount()
    runs.length = 0
    reduce(true)
    render(<Light />)
    expect(runs).toHaveLength(COLUMN_COUNT)
    expect(runs.every((run) => run.options.duration === 1)).toBe(true)
  })

  it('rests its drift while the window is behind others, and drifts again in front', () => {
    render(<Light />)
    const forever = runs.filter((run) => run.options.iterations === Infinity)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(forever.every((run) => run.pause.mock.calls.length === 1)).toBe(true)
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(forever.every((run) => run.play.mock.calls.length === 1)).toBe(true)
  })

  it('sinks from the edges in, from where it stood, and says when it has lain down', async () => {
    const onSunk = vi.fn()
    const { rerender } = render(<Light onSunk={onSunk} />)
    const before = [...runs]
    runs.length = 0
    rerender(<Light sink onSunk={onSunk} />)
    expect(before.every((run) => run.cancel.mock.calls.length > 0)).toBe(true)
    const sinking = runs.filter((run) => run.target.tagName === 'CANVAS')
    expect(sinking).toHaveLength(COLUMN_COUNT)
    expect(sinking.every((run) => run.frames.at(-1)?.transform === 'scaleY(0)')).toBe(true)
    // The edges go first.
    expect(Number(sinking[0]?.options.delay)).toBeLessThan(Number(sinking[Math.floor(COLUMN_COUNT / 2)]?.options.delay))
    await act(async () => {
      await Promise.resolve()
    })
    expect(onSunk).toHaveBeenCalledTimes(1)
  })

  it('cancels what it runs when it goes', () => {
    const { unmount } = render(<Light />)
    unmount()
    expect(runs.every((run) => run.cancel.mock.calls.length > 0)).toBe(true)
  })

  it('drifts each column from rest and back, the same every time', () => {
    const column = COLUMNS[3]
    if (!column) throw new Error('no column')
    const [breathe, glow] = driftOf(column, 0.3)
    expect(breathe?.frames[0]?.transform).toBe('translateX(0px) scaleY(0.3)')
    expect(breathe?.frames.at(-1)?.transform).toBe('translateX(0px) scaleY(0.3)')
    expect(glow?.frames.map((frame) => frame.opacity)).toEqual([1, expect.any(Number), 1])
    expect(breathe?.duration).toBeGreaterThanOrEqual(LIGHT.breathe.length)
    expect(driftOf(column, 0.3)).toEqual(driftOf(column, 0.3))
    for (let i = 0; i < 40; i++) expect(vary(i, 1)).toBeGreaterThanOrEqual(0)
  })
})

describe('the light without a compositor', () => {
  it('stands, and lies down at once', () => {
    const onSunk = vi.fn()
    const { rerender } = render(<Light onSunk={onSunk} />)
    rerender(<Light sink onSunk={onSunk} />)
    expect(onSunk).toHaveBeenCalledTimes(1)
  })
})

/* A 2D context that records the dots it is asked to draw. */
function recorder() {
  const arcs: number[] = []
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn((_x: number, _y: number, r: number) => void arcs.push(r)),
    fill: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
  }
  return { context: context as unknown as CanvasRenderingContext2D, arcs }
}

describe('the halftone mark', () => {
  const end = HALFTONE_RISE.point.start + HALFTONE_RISE.point.length

  it('draws every dot and the point once it is up, and nothing at the start', () => {
    const set = recorder()
    drawHalftone(set.context, 10, end, '#000', '#00f')
    expect(set.arcs).toHaveLength(DOTS.length + 1)
    const start = recorder()
    drawHalftone(start.context, 10, 0, '#000', '#00f')
    expect(start.arcs).toHaveLength(0)
  })

  it('comes up base first', () => {
    const early = recorder()
    drawHalftone(early.context, 10, HALFTONE_RISE.dot, '#000', '#00f')
    expect(early.arcs.length).toBeGreaterThan(0)
    expect(early.arcs.length).toBeLessThan(DOTS.length)
  })

  it('is drawn set with motion reduced, and comes up frame by frame otherwise', () => {
    const { context, arcs } = recorder()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    reduce(true)
    const { unmount } = render(<HalftoneMark size={48} />)
    expect(arcs).toHaveLength(DOTS.length + 1)
    unmount()
    reduce(false)
    arcs.length = 0
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<HalftoneMark size={48} />)
    frames.shift()?.(0)
    expect(arcs).toHaveLength(0)
    frames.shift()?.(end + 1)
    expect(arcs).toHaveLength(DOTS.length + 1)
    expect(frames).toHaveLength(0)
  })

  it('draws set when told not to come up', () => {
    const { context, arcs } = recorder()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    render(<HalftoneMark rise={false} />)
    expect(arcs).toHaveLength(DOTS.length + 1)
  })
})

describe('the home at rest', () => {
  it('names itself by its title, and leaves when told', () => {
    const onLeft = vi.fn()
    const { getByRole, rerender } = render(<HomeRest title="All quiet" note="Nothing needs you." onLeft={onLeft} />)
    expect(getByRole('region', { name: 'All quiet' })).toBeInTheDocument()
    rerender(<HomeRest title="All quiet" leaving onLeft={onLeft} />)
    expect(onLeft).toHaveBeenCalledTimes(1)
  })
})
