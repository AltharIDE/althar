import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Welcome } from '../src/screens/Welcome/Welcome'

/*
 * The welcome's scenes run on timers, fly on element.animate and measure the
 * page, none of which jsdom does. Here the timers are fake, an animation is a
 * timer that finishes it, every box measures the same, and the window can be
 * made wide. Then the table is walked end to end.
 */

/* An animation that finishes when its time is up, as a browser's would. */
function animations() {
  const animate = vi.fn(function (_frames: Keyframe[], options?: number | KeyframeAnimationOptions) {
    const ms = typeof options === 'number' ? options : Number(options?.duration ?? 0)
    const a = {
      onfinish: null as null | (() => void),
      finish() {
        clearTimeout(t)
        a.onfinish?.()
      },
    }
    const t = setTimeout(() => a.onfinish?.(), ms)
    return a as unknown as Animation
  })
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return animate
}

/* Every box, and every run of text, is somewhere with a size. */
function layout() {
  const rect = { x: 10, y: 20, left: 10, top: 20, width: 120, height: 24, right: 130, bottom: 44, toJSON: () => ({}) } as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  Object.defineProperty(Range.prototype, 'getClientRects', { value: () => [rect], configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 120, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get: () => 24, configurable: true })
}

/* A window of this size. */
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

/* A script awaits each beat before scheduling the next, so time moves in small acts that let promises settle. */
const run = async (ms: number) => {
  for (let i = 0; i < ms / 50; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /Continue|Begin|Find my agents/ }))

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
  for (const name of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const)
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

/* the walk moves a minute of the table's time in small acts, which is slow under coverage */
describe('Welcome', { timeout: 30000 }, () => {
  it('walks the table: every scene plays through to its end, and the last press leaves', async () => {
    const onDone = vi.fn()
    render(<Welcome onDone={onDone} />)
    next()
    expect(screen.getByRole('heading', { name: 'A project holds the work' })).toBeInTheDocument()
    /* the empty table, the flight in, and the project's script */
    await run(12000)
    expect(screen.getByText('Session tokens rotate on privilege change')).toBeInTheDocument()
    expect(screen.getByText('What it learned stays')).toBeInTheDocument()
    expect(screen.getByText('Merged · left a note for the project')).toBeInTheDocument()

    next()
    await run(10000)
    expect(screen.getByText('The lead: the agent in charge')).toBeInTheDocument()
    expect(screen.getByText('Steps report back to the lead')).toBeInTheDocument()

    /* the pointer opens the call, picks an answer and records it */
    next()
    await run(6500)
    expect(screen.getByText('Only this waits for you')).toBeInTheDocument()
    await run(6500)
    expect(screen.getByText('Answered: back to the work')).toBeInTheDocument()
    expect(screen.getByText('retries with backoff, as you chose')).toBeInTheDocument()

    /* the pointer accepts the change */
    next()
    await run(10000)
    expect(screen.getByText('Merging stays yours')).toBeInTheDocument()

    next()
    await run(7000)
    expect(screen.getByText('One lab checks another')).toBeInTheDocument()

    next()
    await run(2000)
    expect(screen.getByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument()
    next()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows how a scene ends when it is left before its script finishes', async () => {
    render(<Welcome defaultStep={3} onDone={() => {}} />)
    /* the table, the flight in, and a moment of the scene */
    await run(4200)
    expect(screen.queryByText('Answered: back to the work')).not.toBeInTheDocument()
    next()
    await run(100)
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(screen.getByText('Answered: back to the work')).toBeInTheDocument()
  })

  it('arrives finished with no motion, and keeps the camera placed when the window changes', () => {
    const resize = resizes()
    render(<Welcome defaultStep={4} still onDone={() => {}} />)
    expect(screen.getByText('Merging stays yours')).toBeInTheDocument()
    const world = document.querySelector<HTMLElement>('[data-stop="1"]')!.parentElement!
    const before = world.style.transform
    windowOf(700, 900)
    act(() => resize())
    expect(world.style.transform).not.toBe(before)
    expect(animate).not.toHaveBeenCalled()
  })

  it('cuts for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList)
    render(<Welcome defaultStep={5} onDone={() => {}} />)
    expect(screen.getByText('One lab checks another')).toBeInTheDocument()
  })

  it('moves with the arrows, and leaves them alone with a modifier held', () => {
    render(<Welcome defaultStep={1} still onDone={() => {}} />)
    /* Continue keeps focus, so the keys land inside the welcome */
    const here = () => document.activeElement ?? document.body
    fireEvent.keyDown(here(), { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: 'Every task has a lead' })).toBeInTheDocument()
    fireEvent.keyDown(here(), { key: 'ArrowRight', metaKey: true })
    fireEvent.keyDown(here(), { key: 'a' })
    expect(screen.getByRole('heading', { name: 'Every task has a lead' })).toBeInTheDocument()
    fireEvent.keyDown(here(), { key: 'ArrowLeft' })
    fireEvent.keyDown(here(), { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: /Begin/ })).toBeInTheDocument()
  })

  it('leaves the arrows alone when focus is elsewhere on the page', () => {
    render(
      <>
        <input aria-label="Elsewhere" />
        <Welcome defaultStep={1} still onDone={() => {}} />
      </>,
    )
    const heading = screen.getByRole('heading').textContent
    const elsewhere = screen.getByRole('textbox', { name: 'Elsewhere' })
    elsewhere.focus()
    fireEvent.keyDown(elsewhere, { key: 'ArrowRight' })
    expect(screen.getByRole('heading').textContent).toBe(heading)
  })

  it('flies back to the opening, and straight in again', async () => {
    render(<Welcome defaultStep={1} onDone={() => {}} />)
    const world = document.querySelector<HTMLElement>('[data-stop="1"]')!.parentElement!
    /* the table's own flights, apart from the scenes' motion */
    const flights = () => animate.mock.contexts.filter((c) => c === world).length
    await run(4000)
    let flown = flights()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(flights()).toBe(flown + 1)
    await run(2500)
    flown = flights()
    next()
    expect(flights()).toBe(flown + 1)
    await run(3000)
    expect(flights()).toBe(flown + 1)
  })

  it('draws the route beside the camera as it passes, and rubs it out going back', async () => {
    render(<Welcome defaultStep={1} onDone={() => {}} />)
    const leg = document.querySelector('[data-leg="0"]')
    const drawn = () => animate.mock.calls.filter((_, i) => animate.mock.contexts[i] === leg).map(([k]) => k)
    await run(500)
    next()
    const [ahead] = drawn()
    expect(ahead![0]!.strokeDashoffset).toBe('1')
    expect(ahead!.at(-1)!.strokeDashoffset).toBe('0')
    await run(3500)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    const [, back] = drawn()
    expect(back![0]!.strokeDashoffset).toBe('0')
    expect(back!.at(-1)!.strokeDashoffset).toBe('1')
  })
})
