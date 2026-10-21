import { act, render } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COLUMN_COUNT, COLUMNS, drawColumn, toneOf } from '../src/foundations/Light/columns'
import { LIGHT, Light } from '../src/foundations/Light/Light'

/*
 * The light as it is drawn, and as it sinks from where the compositor has it
 * standing: what light.test.tsx leaves to a browser.
 */

interface Run {
  target: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
}

/** Element.animate, recording what it is asked to run. */
function compositor() {
  const runs: Run[] = []
  const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    runs.push({ target: this, frames, options })
    return {
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      finished: Promise.resolve(),
      effect: { getTiming: () => ({ iterations: Number(options.iterations ?? 1) }) },
    } as unknown as Animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return runs
}

/* What the compositor says each part stands at: the light swayed, every column part way up, but one not yet risen. */
const standing = () => {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (element.tagName === 'CANVAS') {
      const i = Array.from(element.parentElement!.children).indexOf(element)
      return (
        i === 0 ? { transform: 'none', opacity: '' } : { transform: `matrix(1, 0, 0, 0.${i}, 0, 0)`, opacity: '0.8' }
      ) as CSSStyleDeclaration
    }
    if (element.className.includes('light'))
      return { transform: 'matrix(1, 0, 0, 1, 12, 0)', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration
    return real(element, pseudo)
  })
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']
})

describe('the light, drawn', () => {
  it('draws each column once, its foot in the window’s live colour in the middle, and lays its grain over it', () => {
    const feet: string[] = []
    const context = {
      createLinearGradient: () => ({ addColorStop: (at: number, colour: string) => void (at === 0 && feet.push(colour)) }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      filter: '',
      fillStyle: '',
    }
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as HTMLCanvasElement['getContext']
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,GRAIN')
    const { container } = render(<Light motion="still" style={{ '--live': '#123456' } as CSSProperties} />)
    expect(feet).toHaveLength(COLUMN_COUNT)
    const middle = COLUMNS.filter((column) => column.tones[0] === toneOf(0)[0]).length
    expect(middle).toBeGreaterThan(0)
    expect(feet.filter((colour) => colour === '#123456')).toHaveLength(middle)
    expect(feet).not.toContain(toneOf(0)[0])
    expect(context.putImageData).toHaveBeenCalledOnce()
    const grain = Array.from(container.querySelectorAll<HTMLElement>('div')).find((one) => one.style.backgroundImage !== '')
    expect(grain?.style.backgroundImage).toContain('data:image/png;base64,GRAIN')
  })

  it('keeps the middle’s own colour where the window says no live colour', () => {
    const feet: string[] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      // Only the columns draw; the grain's tile has no context here.
      if (this.isConnected === false) return null
      return {
        createLinearGradient: () => ({ addColorStop: (at: number, colour: string) => void (at === 0 && feet.push(colour)) }),
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        ellipse() {},
        closePath() {},
        fill() {},
      }
    }) as unknown as HTMLCanvasElement['getContext']
    const { container } = render(<Light motion="still" />)
    expect(feet).toContain(toneOf(0)[0])
    expect(Array.from(container.querySelectorAll<HTMLElement>('div')).every((one) => one.style.backgroundImage === '')).toBe(true)
  })
})

describe('the light, on dark', () => {
  /** Every stop a column's gradient is given, in order. */
  const stopsOf = (column: (typeof COLUMNS)[number], dark: boolean) => {
    const stops: Array<[number, string]> = []
    const context = {
      createLinearGradient: () => ({ addColorStop: (at: number, colour: string) => void stops.push([at, colour]) }),
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      ellipse() {},
      closePath() {},
      fill() {},
      filter: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D
    drawColumn(context, column, '#8a95ff', dark)
    return stops
  }
  const alphaOf = (colour: string) => Number(/rgba\(.*,\s*([\d.]+)\)$/.exec(colour)?.[1])

  it('glows rather than pales: each column thins its own saturated foot to nothing, never to white', () => {
    for (const column of COLUMNS) {
      const stops = stopsOf(column, true)
      expect(stops.map(([at]) => at)).toEqual([0, 0.34, 0.66, 1])
      const alphas = stops.map(([, colour]) => alphaOf(colour))
      expect(alphas.at(-1)).toBe(0)
      // fainter as it rises
      expect(alphas[0]!).toBeGreaterThan(alphas[1]!)
      expect(alphas[1]!).toBeGreaterThan(alphas[2]!)
      // one hue all the way up: no pale tone, no white
      const hues = new Set(stops.map(([, colour]) => colour.replace(/,\s*[\d.]+\)$/, ')')))
      expect(hues.size).toBe(1)
      expect([...hues][0]).not.toBe('rgba(255, 255, 255)')
    }
  })

  it('lets the cobalt middle lead: the outer columns are fainter, the corners warm', () => {
    const middle = COLUMNS.find((column) => column.d < 0.16)!
    const edge = COLUMNS.find((column) => column.d >= 0.8)!
    expect(alphaOf(stopsOf(middle, true)[0]![1])).toBe(1)
    expect(alphaOf(stopsOf(edge, true)[0]![1])).toBeLessThan(0.5)
    expect(stopsOf(edge, true)[0]![1]).toBe('rgba(255, 148, 102, 0.4)')
  })

  it('draws as on paper where the theme is light', () => {
    const column = COLUMNS.find((one) => one.d >= 0.8)!
    expect(stopsOf(column, false).map(([, colour]) => colour)).toEqual([...column.tones, 'rgba(255, 255, 255, 0)'])
  })

  it('draws again when the theme turns dark, in the dark light', async () => {
    const feet: string[] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      if (this.isConnected === false) return null
      return {
        createLinearGradient: () => ({ addColorStop: (at: number, colour: string) => void (at === 0 && feet.push(colour)) }),
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        ellipse() {},
        closePath() {},
        fill() {},
      }
    }) as unknown as HTMLCanvasElement['getContext']
    try {
      render(<Light motion="still" />)
      expect(feet).toHaveLength(COLUMN_COUNT)
      await act(async () => void (document.documentElement.dataset.theme = 'dark'))
      expect(feet).toHaveLength(2 * COLUMN_COUNT)
      expect(feet.slice(COLUMN_COUNT).every((colour) => colour.startsWith('rgba('))).toBe(true)
    } finally {
      delete document.documentElement.dataset.theme
    }
  })
})

describe('the light, sinking', () => {
  it('sinks from where the compositor has it standing, holding its sway', () => {
    const runs = compositor()
    const { rerender, container } = render(<Light />)
    standing()
    runs.length = 0
    rerender(<Light sink />)
    const root = container.firstElementChild!
    const held = runs.filter((run) => run.target === root)
    expect(held).toEqual([
      {
        target: root,
        frames: [{ transform: 'matrix(1, 0, 0, 1, 12, 0)' }, { transform: 'matrix(1, 0, 0, 1, 12, 0)' }],
        options: { duration: 1, fill: 'forwards' },
      },
    ])
    const sinking = runs.filter((run) => run.target.tagName === 'CANVAS')
    expect(sinking).toHaveLength(COLUMN_COUNT)
    // One not yet up sinks from where it would stand, whole.
    expect(sinking[0]?.frames).toEqual([
      { transform: `scaleY(${COLUMNS[0]!.height * 0.62})`, opacity: '1' },
      { transform: 'scaleY(0)', opacity: '1' },
    ])
    expect(sinking[5]?.frames).toEqual([
      { transform: 'matrix(1, 0, 0, 0.5, 0, 0)', opacity: '0.8' },
      { transform: 'scaleY(0)', opacity: '0.8' },
    ])
    expect(sinking[5]?.options.duration).toBe(LIGHT.sink.length)
  })

  it('lies down at once with motion reduced, and says so', async () => {
    const runs = compositor()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    )
    const onSunk = vi.fn()
    const { rerender } = render(<Light onSunk={onSunk} />)
    runs.length = 0
    rerender(<Light sink onSunk={onSunk} />)
    const sinking = runs.filter((run) => run.target.tagName === 'CANVAS')
    expect(sinking).toHaveLength(COLUMN_COUNT)
    expect(sinking.every((run) => run.options.duration === 1 && run.options.delay === 0)).toBe(true)
    await act(async () => {})
    expect(onSunk).toHaveBeenCalledOnce()
  })
})
