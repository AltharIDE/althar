import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTypedTitle } from '../src/lib/typedTitle'

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
    const { result, rerender } = renderHook(({ title, by }) => useTypedTitle(title, by), {
      initialProps: { title: 'Fix login', by: null as string | null },
    })
    rerender({ title: 'Repair sessions', by: 'Repair sessions' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 4))
    expect(result.current).toBe('Fix ▏')
    act(() => void vi.advanceTimersByTime(16 * 5 + 160))
    expect(result.current).toBe('R▏')
    act(() => void vi.advanceTimersByTime(34 * 13))
    expect(result.current).toBe('Repair session▏')
    act(() => void vi.advanceTimersByTime(34))
    expect(result.current).toBe('Repair sessions')
  })

  it("shows a rename the person made, or one made to another task's title, at once", () => {
    const { result, rerender } = renderHook(({ title, by }) => useTypedTitle(title, by), {
      initialProps: { title: 'Fix login', by: null as string | null },
    })
    // An agent last gave this task another title; this one is not it.
    rerender({ title: 'Mine', by: 'Repair sessions' })
    expect(result.current).toBe('Mine')
    rerender({ title: 'Mine too', by: null })
    expect(result.current).toBe('Mine too')
  })

  it('shows a rename at once under reduced motion', () => {
    reduced = true
    const { result, rerender } = renderHook(({ title, by }) => useTypedTitle(title, by), {
      initialProps: { title: 'Fix login', by: null as string | null },
    })
    rerender({ title: 'Repair sessions', by: 'Repair sessions' })
    expect(result.current).toBe('Repair sessions')
  })

  it('starts the next rename from what is drawn when it comes mid-way', () => {
    const { result, rerender } = renderHook(({ title, by }) => useTypedTitle(title, by), {
      initialProps: { title: 'Fix login', by: null as string | null },
    })
    rerender({ title: 'Repair sessions', by: 'Repair sessions' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 4))
    rerender({ title: 'Third', by: 'Third' })
    act(() => void vi.advanceTimersByTime(120 + 16 * 5 + 160 + 34 * 4))
    expect(result.current).toBe('Third')
  })

  it('shows a title at once as it first arrives from blank, even where an agent renamed it', () => {
    const { result, rerender } = renderHook(({ title, by }) => useTypedTitle(title, by), {
      initialProps: { title: '', by: 'Fix login' as string | null },
    })
    rerender({ title: 'Fix login', by: 'Fix login' })
    expect(result.current).toBe('Fix login')
  })
})

describe('a title being typed in, in its crumb', () => {
  it('opens Rename on the real title and leaves it unchanged on blur', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react')
    const { BackCrumb } = await import('../src/chrome/BackCrumb/BackCrumb')
    const onRename = vi.fn()
    render(<BackCrumb to="meridian" onBack={() => {}} title="Repair sessions" shown={'Repair se▏'} onRename={onRename} />)
    fireEvent.click(screen.getByRole('button', { name: /Rename: Repair sessions/ }))
    const field = screen.getByRole('textbox', { name: 'Rename' })
    expect((field as HTMLInputElement).value).toBe('Repair sessions')
    fireEvent.blur(field)
    expect(onRename).not.toHaveBeenCalled()
  })
})

describe('an aside tab', () => {
  it("types in a title an agent renamed, and shows another's at once", async () => {
    const { render, screen, act: actNow } = await import('@testing-library/react')
    const { AsideTabs } = await import('../src/thread/Asides/Asides')
    const tabs = (asides: Array<{ id: string; title: string; byAgent?: string | null }>) => (
      <AsideTabs
        mark={null as never}
        asides={asides}
        older={[]}
        current={null}
        onPick={() => {}}
        onNew={() => {}}
        onClear={() => {}}
        onClearOlder={() => {}}
      />
    )
    const view = render(
      tabs([
        { id: 'a', title: 'Fix login' },
        { id: 'b', title: 'Other' },
      ]),
    )
    view.rerender(
      tabs([
        { id: 'a', title: 'Repair sessions', byAgent: 'Repair sessions' },
        { id: 'b', title: 'Mine', byAgent: null },
      ]),
    )
    expect(screen.queryByText('Mine')).not.toBeNull()
    expect(screen.queryByText('Repair sessions')).toBeNull()
    actNow(() => void vi.advanceTimersByTime(5000))
    expect(screen.queryByText('Repair sessions')).not.toBeNull()
  })
})
