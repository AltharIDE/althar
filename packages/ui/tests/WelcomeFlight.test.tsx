import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Welcome } from '../src/screens/Welcome/Welcome'

/*
 * The welcome's camera between stops, as a browser flies it: an animation
 * that is finished early reports it a moment later, not at once, and the
 * window can change size on the way. Timers are fake, every box measures the
 * same, and the window is wide.
 */

/* An animation that reports its end a moment after it is finished, or when its time is up. */
function animations() {
  const animate = vi.fn(function (_frames: Keyframe[], options?: number | KeyframeAnimationOptions) {
    const ms = typeof options === 'number' ? options : Number(options?.duration ?? 0)
    const a = {
      onfinish: null as null | (() => void),
      finish() {
        clearTimeout(t)
        setTimeout(() => a.onfinish?.(), 0)
      },
    }
    const t = setTimeout(() => a.onfinish?.(), ms)
    return a as unknown as Animation
  })
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return animate
}

function layout() {
  const rect = { x: 10, y: 20, left: 10, top: 20, width: 120, height: 24, right: 130, bottom: 44, toJSON: () => ({}) } as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  Object.defineProperty(Range.prototype, 'getClientRects', { value: () => [rect], configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 120, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get: () => 24, configurable: true })
}

function windowOf(w: number, h: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => w, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => h, configurable: true })
}

/* A resize observer the test fires. */
function resizes() {
  const seen: (() => void)[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        seen.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
  return () => seen.forEach((f) => f())
}

const run = async (ms: number) => {
  for (let i = 0; i < ms / 50; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /Continue|Begin|Find my agents/ }))
const world = () => document.querySelector<HTMLElement>('[data-stop="1"]')!.parentElement!

let animate: ReturnType<typeof animations>
beforeEach(() => {
  vi.useFakeTimers()
  animate = animations()
  layout()
  windowOf(1280, 800)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as unknown as Record<string, unknown>).animate
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
  for (const name of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const)
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

describe('the welcome’s camera between stops', { timeout: 30000 }, () => {
  it('lands only where the latest flight goes when an earlier one reports its end late', async () => {
    render(<Welcome defaultStep={1} onDone={() => {}} />)
    await run(4000)
    /* on to the task, and on again before the camera gets there */
    next()
    next()
    expect(screen.getByRole('heading', { name: 'You make the calls' })).toBeInTheDocument()
    await run(16000)
    /* the calls play to their end; the task, flown past, never started, so it has no ending to show */
    expect(screen.getByText('Answered: back to the work')).toBeInTheDocument()
    expect(screen.queryByText('Steps report back to the lead')).not.toBeInTheDocument()
  })

  it('keeps flying when the window changes size on the way, and is placed for the new size once it lands', async () => {
    const resize = resizes()
    render(<Welcome defaultStep={1} onDone={() => {}} />)
    await run(4000)
    next()
    const aimed = world().style.transform
    windowOf(700, 900)
    act(() => resize())
    expect(world().style.transform).toBe(aimed)
    await run(4000)
    act(() => resize())
    expect(world().style.transform).not.toBe(aimed)
  })

  it('still walks the stops where the page cannot watch the window’s size', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Welcome defaultStep={1} still onDone={() => {}} />)
    next()
    expect(screen.getByRole('heading', { name: 'Every task has a lead' })).toBeInTheDocument()
  })

  it('flies where the page cannot ask about reduced motion', async () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Welcome defaultStep={1} onDone={() => {}} />)
    await run(500)
    next()
    expect(animate.mock.contexts).toContain(world())
  })
})
