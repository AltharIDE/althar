import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markOwnTitle, useTypedTitle } from '../src/lib/typedTitle'

/* An agent's rename types itself in; the person's own, and reduced motion, show at once. */

let reduced = false
beforeEach(() => {
  reduced = false
  vi.useFakeTimers()
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})
afterEach(() => vi.useRealTimers())

describe('useTypedTitle', () => {
  it('is the title where nothing is renamed', () => {
    const { result } = renderHook(() => useTypedTitle('Fix login'))
    expect(result.current).toBe('Fix login')
  })

  it("backspaces an agent's rename, then types the new title, ending at it with no caret", () => {
    const { result, rerender } = renderHook(({ title }) => useTypedTitle(title), { initialProps: { title: 'Fix login' } })
    rerender({ title: 'Repair sessions' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 4))
    expect(result.current).toBe('Fix ▏')
    act(() => void vi.advanceTimersByTime(16 * 5 + 160))
    expect(result.current).toBe('R▏')
    act(() => void vi.advanceTimersByTime(34 * 13))
    expect(result.current).toBe('Repair session▏')
    act(() => void vi.advanceTimersByTime(34))
    expect(result.current).toBe('Repair sessions')
  })

  it("shows the person's own rename at once", () => {
    markOwnTitle('Mine')
    const { result, rerender } = renderHook(({ title }) => useTypedTitle(title), { initialProps: { title: 'Fix login' } })
    rerender({ title: 'Mine' })
    expect(result.current).toBe('Mine')
  })

  it('shows a rename at once under reduced motion', () => {
    reduced = true
    const { result, rerender } = renderHook(({ title }) => useTypedTitle(title), { initialProps: { title: 'Fix login' } })
    rerender({ title: 'Repair sessions' })
    expect(result.current).toBe('Repair sessions')
  })

  it('starts the next rename from what is drawn when it comes mid-way', () => {
    const { result, rerender } = renderHook(({ title }) => useTypedTitle(title), { initialProps: { title: 'Fix login' } })
    rerender({ title: 'Repair sessions' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 4))
    rerender({ title: 'Third' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 5 + 160 + 34 * 4))
    expect(result.current).toBe('Third')
  })
})
