import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Pixels } from '../src/coordinator/Issue/Pixels'
import { useStickToBottom } from '../src/lib/stick'
import { forgetStreamed, Stream, Streamed } from '../src/primitives/Stream/Stream'

/* A 2D context that records what it is asked to fill. */
function fakeContext() {
  const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 70, height: 21 } as DOMRect)
  return ctx
}

/* Observers the test can fire. */
function observers() {
  const resize: (() => void)[] = []
  const seen: ((e: { isIntersecting: boolean }[]) => void)[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resize.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        seen.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
  return { resize: () => resize.forEach((f) => f()), see: (on: boolean) => seen.forEach((f) => f([{ isIntersecting: on }])) }
}

/* Each beat schedules the next after React renders, so time moves in small acts. */
const run = (ms: number) => {
  for (let i = 0; i < ms / 50; i++) void act(() => vi.advanceTimersByTime(50))
}

const motion = (reduce: boolean) => vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduce } as MediaQueryList)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Pixels', () => {
  it('draws one still frame for reduced motion', () => {
    const ctx = fakeContext()
    motion(true)
    render(<Pixels />)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    expect(ctx.fillRect).toHaveBeenCalled()
  })

  it('draws one still frame where there are no observers', () => {
    const ctx = fakeContext()
    motion(false)
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<Pixels />)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
  })

  it('holds a still frame until it plays, then animates at its frame rate while on screen', () => {
    const ctx = fakeContext()
    motion(false)
    const o = observers()
    let frame: FrameRequestCallback = () => {}
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => ((frame = f), 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { rerender, unmount } = render(<Pixels fps={10} />)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    frame(500)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    rerender(<Pixels fps={10} playing />)
    frame(600)
    frame(620)
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    o.see(false)
    frame(1000)
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    o.see(true)
    o.resize()
    expect(ctx.clearRect).toHaveBeenCalledTimes(3)
    frame(2000)
    expect(ctx.clearRect).toHaveBeenCalledTimes(4)
    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('draws nothing without a context', () => {
    render(<Pixels />)
    expect(document.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Stream', () => {
  afterEach(() => forgetStreamed())

  it('paces the words in, breaks paragraphs, and says when it is done once', () => {
    const onDone = vi.fn()
    const content = 'One two three.\n\nFour five six seven eight nine ten.'
    const { container, rerender } = render(<Stream content={content} id="s1" onDone={onDone} />)
    expect(container.querySelector('[aria-busy]')).not.toBeNull()
    run(5000)
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.querySelector('[aria-busy]')).toBeNull()
    expect(onDone).toHaveBeenCalledTimes(1)
    rerender(<Stream content={content} id="s1" onDone={onDone} />)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows a message it has streamed before whole', () => {
    const { unmount } = render(<Streamed content="Seen before, once." id="s2" />)
    run(5000)
    unmount()
    const { container } = render(<Streamed content="Seen before, once." id="s2" />)
    expect(container.textContent).toBe('Seen before, once.')
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })

  it('holds a reply until told to start, then streams it after its delay', () => {
    const { container, rerender } = render(<Streamed content="Held for now." start={false} />)
    run(1000)
    expect(container.textContent).toBe('')
    rerender(<Streamed content="Held for now." delay={200} />)
    run(5000)
    expect(container.textContent).toBe('Held for now.')
    rerender(<Streamed content="A new reply." />)
    run(5000)
    expect(container.textContent).toBe('A new reply.')
  })
})

describe('useStickToBottom', () => {
  function Scroller({ slack }: { slack?: number }) {
    const ref = useRef<HTMLDivElement>(null)
    useStickToBottom(ref, slack)
    return (
      <div ref={ref} data-testid="scroller">
        <div />
      </div>
    )
  }
  const metrics = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  }

  it('follows growth while at the bottom, and not after you scroll away', () => {
    const o = observers()
    render(<Scroller />)
    const el = screen.getByTestId('scroller')
    metrics(el, 1000, 400)
    o.resize()
    expect(el.scrollTop).toBe(1000)
    el.scrollTop = 100
    fireEvent.scroll(el)
    metrics(el, 1400, 400)
    o.resize()
    expect(el.scrollTop).toBe(100)
  })

  it('does nothing without a ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Scroller />)
    expect(screen.getByTestId('scroller').scrollTop).toBe(0)
  })
})
