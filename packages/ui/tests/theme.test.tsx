import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HalftoneMark } from '../src/foundations/HalftoneMark/HalftoneMark'
import { useTheme } from '../src/lib/theme'

/* The theme a canvas draws by: the root's data-theme, read again as it changes. */

afterEach(() => {
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']
})

describe('useTheme', () => {
  it('is light where the root names no theme, and light for one it doesn’t know', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe('light')
    act(() => void (document.documentElement.dataset.theme = 'sepia'))
    expect(result.current).toBe('light')
  })

  it('follows the root to dark and back', async () => {
    const { result } = renderHook(() => useTheme())
    await act(async () => void (document.documentElement.dataset.theme = 'dark'))
    expect(result.current).toBe('dark')
    await act(async () => void (document.documentElement.dataset.theme = 'light'))
    expect(result.current).toBe('light')
  })

  it('stops listening once nothing uses it', async () => {
    const { result, unmount } = renderHook(() => useTheme())
    unmount()
    await act(async () => void (document.documentElement.dataset.theme = 'dark'))
    expect(result.current).toBe('light')
  })
})

describe('the halftone mark in another theme', () => {
  it('draws again at once, risen already, in the theme’s ink', async () => {
    const inks: string[] = []
    const context = {
      setTransform() {},
      clearRect: vi.fn(),
      beginPath() {},
      arc() {},
      fill() {},
      globalAlpha: 1,
      set fillStyle(value: string) {
        inks.push(value)
      },
    }
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as HTMLCanvasElement['getContext']
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    // The tokens as each theme has them: the mark reads its ink and cobalt off its canvas.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      const dark = document.documentElement.dataset.theme === 'dark'
      const tokens: Record<string, string> = dark
        ? { '--ink-fill': '#ddd7cc', '--live': '#8a95ff' }
        : { '--ink-fill': '#141417', '--live': '#2b3bff' }
      return { getPropertyValue: (name: string) => tokens[name] ?? '' } as CSSStyleDeclaration
    })
    render(<HalftoneMark />)
    // rising: nothing drawn until its first frame
    expect(context.clearRect).not.toHaveBeenCalled()
    await act(async () => void (document.documentElement.dataset.theme = 'dark'))
    // set at once, without rising again, in the dark ink and cobalt
    expect(context.clearRect).toHaveBeenCalledOnce()
    expect(inks).toContain('#ddd7cc')
    expect(inks).toContain('#8a95ff')
  })
})
