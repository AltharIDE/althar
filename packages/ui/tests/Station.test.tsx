import { act, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Note, Station, layoutIn, useScene, type Stage } from '../src/screens/Welcome/Station'

/*
 * A stop on the welcome's table, apart from the welcome: the sketch it traces
 * of the components inside, the notes it pins to their parts, and the script
 * that points at and presses them. jsdom lays nothing out, so each test says
 * where things are; the scene's own styles say what draws a box.
 */

const rect = (left: number, top: number, width: number, height: number) =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect

/* Every element the same box, unless it says otherwise in data-rect="left top width height". */
function layout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const own = this.getAttribute('data-rect')
    if (own) {
      const [l, t, w, h] = own.split(' ').map(Number)
      return rect(l!, t!, w!, h!)
    }
    return rect(0, 0, 120, 24)
  })
  /* laid out at the size it is drawn: the camera does not scale a stop here */
  for (const [name, side] of [
    ['offsetWidth', 'width'],
    ['offsetHeight', 'height'],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.getBoundingClientRect()[side]
      },
    })
}

const station = (children: ReactNode, more: { built?: boolean; instant?: boolean } = {}) => (
  <Station n={1} label="A project" x={0} y={0} shown built={more.built ?? false} instant={more.instant ?? false}>
    {children}
  </Station>
)

const sketch = () => document.querySelector('svg[class*="sketch"]')

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
  for (const name of ['offsetWidth', 'offsetHeight']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

describe('the sketch of a stop as it is built', () => {
  beforeEach(layout)

  it('traces what draws a box, a fill, a shadow or a border, and leaves out what draws none or is hidden', () => {
    render(
      station(
        <>
          <div style={{ backgroundColor: 'rgb(200, 0, 0)', boxShadow: 'none' }} />
          <div style={{ backgroundColor: 'transparent', boxShadow: 'none', borderTop: '2px solid' }} />
          <div style={{ boxShadow: 'none' }} />
          <div style={{ display: 'none' }} />
          <div style={{ visibility: 'hidden' }} />
        </>,
        { built: true },
      ),
    )
    expect(sketch()?.querySelectorAll('rect')).toHaveLength(2)
    expect(sketch()?.querySelectorAll('path')).toHaveLength(0)
  })

  it('draws a pencil line under each run of text wide enough to see, and skips slivers', () => {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range) {
        const words = this.startContainer.textContent
        return words === 'i' ? [rect(0, 0, 3, 14)] : [rect(0, 0, 80, 14), rect(0, 16, 40, 14)]
      },
    })
    render(
      station(
        <p style={{ boxShadow: 'none' }}>
          <span style={{ boxShadow: 'none' }}>Repair token refresh</span>
          <span style={{ boxShadow: 'none' }}>i</span>
        </p>,
        { built: true },
      ),
    )
    expect(sketch()?.querySelectorAll('path')).toHaveLength(2)
    expect(sketch()?.querySelectorAll('rect')).toHaveLength(0)
  })

  it('stops tracing a crowded scene at its limit', () => {
    render(
      station(
        <>
          {Array.from({ length: 200 }, (_, i) => (
            <div key={i} style={{ backgroundColor: 'rgb(0, 0, 200)' }} />
          ))}
        </>,
        { built: true },
      ),
    )
    expect(sketch()?.querySelectorAll('rect')).toHaveLength(180)
  })

  it('arrives without a sketch when it arrives built', () => {
    render(station(<div style={{ backgroundColor: 'rgb(200, 0, 0)' }} />, { built: true, instant: true }))
    expect(sketch()).toBeNull()
  })
})

describe('where a part sits in a stop, by layout', () => {
  /* Positioned the way a browser would: each offset is from the element's offset parent, inside that parent's border. */
  const place = (el: HTMLElement, at: { left: number; top: number; parent: Element | null; border?: number; w?: number; h?: number }) => {
    Object.defineProperties(el, {
      offsetLeft: { configurable: true, get: () => at.left },
      offsetTop: { configurable: true, get: () => at.top },
      offsetParent: { configurable: true, get: () => at.parent },
      clientLeft: { configurable: true, get: () => at.border ?? 0 },
      clientTop: { configurable: true, get: () => at.border ?? 0 },
      offsetWidth: { configurable: true, get: () => at.w ?? 0 },
      offsetHeight: { configurable: true, get: () => at.h ?? 0 },
    })
  }

  it('adds up the offsets to the stop, with the border of each parent between', () => {
    const root = document.createElement('div')
    const card = document.createElement('div')
    const title = document.createElement('span')
    root.append(card)
    card.append(title)
    place(card, { left: 40, top: 30, parent: root, border: 1 })
    place(title, { left: 12, top: 8, parent: card, w: 90, h: 18 })
    expect(layoutIn(root, title, () => 2)).toEqual({ x: 53, y: 39, w: 90, h: 18 })
  })

  it('measures the screen instead when the part is not laid out under the stop, scaled to station pixels', () => {
    layout()
    const root = document.createElement('div')
    root.setAttribute('data-rect', '100 50 400 300')
    const away = document.createElement('span')
    away.setAttribute('data-rect', '130 70 60 20')
    expect(layoutIn(root, away, () => 2)).toEqual({ x: 60, y: 40, w: 120, h: 40 })
  })
})

describe('a note pinned to a part', () => {
  beforeEach(layout)

  /* A scene's notes come once it plays, after its stop is on the table, as they do on the welcome. */
  const later = (note: ReactNode, outside?: ReactNode) => {
    const scene = (shown: boolean) => (
      <>
        {shown && outside}
        {station(
          <>
            <p>Repair token refresh</p>
            {shown && note}
          </>,
        )}
      </>
    )
    const { rerender } = render(scene(false))
    rerender(scene(true))
  }

  it('pins nothing outside a stop, or to a part the scene does not show', () => {
    later(
      <Note target="Not in this scene" side="right" label="Nowhere" />,
      <Note target="Merged" side="left" label="Merging stays yours" />,
    )
    expect(screen.queryByText('Merging stays yours')).not.toBeInTheDocument()
    expect(screen.queryByText('Nowhere')).not.toBeInTheDocument()
  })

  it('still pins once where the page cannot watch the scene change', () => {
    vi.stubGlobal('MutationObserver', undefined)
    later(<Note target="Repair token refresh" side="top" label="A task comes, works, and goes" />)
    expect(screen.getByText('A task comes, works, and goes')).toBeInTheDocument()
  })
})

/* A scene with a control, a card whose title stretches over it, and plain words, run by the script it is given. */
function Scene({
  live,
  script,
  end,
  onMerge,
  onOpen,
}: {
  live: boolean
  script: (stage: Stage) => Promise<void>
  end: () => void
  onMerge?: () => void
  onOpen?: () => void
}) {
  const pointer = useScene(live, false, script, end)
  return (
    <div data-rect="0 0 600 400" style={{ boxShadow: 'none' }}>
      <button type="button" data-rect="20 20 80 24" onClick={onMerge}>
        Merge
      </button>
      <article data-rect="20 80 320 120" style={{ backgroundColor: 'rgb(250, 250, 250)', borderTopLeftRadius: '10px' }}>
        <a href="#task" data-stretched data-rect="36 96 200 20" onClick={(e) => (e.preventDefault(), onOpen?.())}>
          Repair token refresh
        </a>
      </article>
      <section data-rect="20 240 400 60" style={{ boxShadow: 'none' }}>
        <p data-rect="30 250 140 18" style={{ boxShadow: 'none' }}>
          Nothing needs you
        </p>
      </section>
      {pointer}
    </div>
  )
}

/* Time moves in small acts, so each awaited beat lets the next be scheduled. */
const run = async (ms: number) => {
  for (let i = 0; i < ms / 50; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
}

const wash = () => document.querySelector<HTMLElement>('[class~="wash"]')!

describe('a scene’s script', () => {
  let animate: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    layout()
    animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
  })
  afterEach(() => {
    delete (Element.prototype as unknown as Record<string, unknown>).animate
  })

  it('lights the box around plain words it points at, and nothing when the words are not there', async () => {
    const lit: (string | undefined)[] = []
    const script = async (stage: Stage) => {
      await stage.point('Not in this scene')
      lit.push(wash().style.width)
      await stage.point('Nothing needs you', 'section')
      lit.push(wash().style.width)
    }
    render(station(<Scene live script={script} end={() => {}} />))
    await run(2000)
    /* nothing round the words draws a box until the scene itself, which is outside what the script may light: the words light themselves */
    expect(lit).toEqual(['', '140px'])
  })

  it('lights a card when it points at the card’s stretched title, and opens it on a press', async () => {
    const real = globalThis.getComputedStyle
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el, pseudo) =>
      pseudo === '::after' && el instanceof HTMLElement && el.hasAttribute('data-stretched')
        ? ({ position: 'absolute', content: '""' } as CSSStyleDeclaration)
        : real(el, pseudo),
    )
    const onOpen = vi.fn()
    let over = ''
    const script = async (stage: Stage) => {
      await stage.point('Repair token refresh')
      over = `${wash().style.width} ${wash().style.height} ${wash().style.borderRadius}`
      await stage.press()
    }
    render(station(<Scene live script={script} end={() => {}} onOpen={onOpen} />))
    await run(2000)
    expect(over).toBe('320px 120px 10px')
    expect(onOpen).toHaveBeenCalledTimes(1)
    /* a wide part gives less under the press than a small one */
    expect(animate.mock.calls[0]?.[0]).toContainEqual(expect.objectContaining({ transform: 'scale(0.985)' }))
  })

  it('presses a small control harder, and a press with nothing pointed at presses nothing', async () => {
    const onMerge = vi.fn()
    const script = async (stage: Stage) => {
      await stage.press()
      await stage.point('Merge')
      await stage.press()
    }
    render(station(<Scene live script={script} end={() => {}} onMerge={onMerge} />))
    await run(2500)
    expect(onMerge).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0]?.[0]).toContainEqual(expect.objectContaining({ transform: 'scale(0.95)' }))
  })

  /* A scene that a test leaves with a press outside it. */
  function Leaving({ script, end }: { script: (stage: Stage) => Promise<void>; end: () => void }) {
    const [live, setLive] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setLive(false)}>
          Leave
        </button>
        {station(<Scene live={live} script={script} end={end} />)}
      </>
    )
  }

  it('ends once when it is left, though its script finishes after', async () => {
    let release = () => {}
    const script = () => new Promise<void>((done) => (release = done))
    const end = vi.fn()
    render(<Leaving script={script} end={end} />)
    await run(100)
    act(() => screen.getByRole('button', { name: 'Leave' }).click())
    await act(async () => release())
    await run(100)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('shows how it ends when it is left, and stops its script at the next wait', async () => {
    let release = () => {}
    const steps: string[] = []
    const script = async (stage: Stage) => {
      steps.push('started')
      await new Promise<void>((done) => (release = done))
      steps.push('released')
      await stage.wait(100)
      steps.push('went on')
    }
    const end = vi.fn()
    render(<Leaving script={script} end={end} />)
    await run(100)
    act(() => screen.getByRole('button', { name: 'Leave' }).click())
    expect(end).toHaveBeenCalledTimes(1)
    await act(async () => release())
    await run(200)
    expect(steps).toEqual(['started', 'released'])
    expect(end).toHaveBeenCalledTimes(1)
  })
})
