import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Pixels } from '../src/coordinator/Issue/Pixels'

/* Linear's field of squares, drawn once (reduced motion) where the page tells it little. */

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>).devicePixelRatio
})

describe('the field of squares', () => {
  it('draws in black, a pixel to a point, where the page gives neither its colour in numbers nor a pixel ratio', () => {
    const fills: string[] = []
    const ctx = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      fillRect() {
        fills.push(this.fillStyle)
      },
      fillStyle: '',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 70, height: 21 } as DOMRect)
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const real = globalThis.getComputedStyle
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el instanceof HTMLCanvasElement ? ({ color: 'canvastext' } as CSSStyleDeclaration) : real(el, pseudo),
    )
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: undefined })
    const { container } = render(<Pixels />)
    expect(container.querySelector('canvas')?.width).toBe(70)
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every((fill) => fill.startsWith('rgba(0, 0, 0, '))).toBe(true)
  })
})
