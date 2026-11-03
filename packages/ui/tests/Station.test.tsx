import { act, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Station, useScene, type Stage } from '../src/screens/Welcome/Station'

/*
 * Where a tour page's scene is drawn, apart from the welcome: the sketch it
 * traces of the components inside, and the script that plays the scene.
 * jsdom lays nothing out, so each test says where things are; the scene's own
 * styles say what draws a box.
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

const station = (children: ReactNode, more: { instant?: boolean } = {}) => <Station instant={more.instant ?? false}>{children}</Station>

const sketch = () => document.querySelector('svg[class*="sketch"]')

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects
  for (const name of ['offsetWidth', 'offsetHeight']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
})

describe('the sketch of a scene as it arrives', () => {
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
      ),
    )
    expect(sketch()?.querySelectorAll('rect')).toHaveLength(180)
  })

  it('arrives without a sketch when it arrives still', () => {
    render(station(<div style={{ backgroundColor: 'rgb(200, 0, 0)' }} />, { instant: true }))
    expect(sketch()).toBeNull()
  })
})

/* A scene run by the script it is given. */
function Scene({ live, script, end }: { live: boolean; script: (stage: Stage) => Promise<void>; end: () => void }) {
  useScene(live, false, script, end)
  return <p>Repair token refresh</p>
}

/* Time moves in small acts, so each awaited beat lets the next be scheduled. */
const run = async (ms: number) => {
  for (let i = 0; i < ms / 50; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
}

describe('a scene’s script', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    layout()
  })

  it('plays through its waits, and ends once', async () => {
    const steps: string[] = []
    const script = async (stage: Stage) => {
      await stage.wait(300)
      steps.push('first')
      await stage.wait(300)
      steps.push('second')
    }
    const end = vi.fn()
    render(station(<Scene live script={script} end={end} />))
    await run(800)
    expect(steps).toEqual(['first', 'second'])
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('shows how it ends at once when it arrives still, and plays nothing', async () => {
    const script = vi.fn(async () => {})
    const end = vi.fn()
    function Still() {
      useScene(true, true, script, end)
      return null
    }
    render(<Still />)
    await run(100)
    expect(script).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
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
