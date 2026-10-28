import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useControlled } from '../src/lib/controlled'

afterEach(() => vi.restoreAllMocks())

describe('state a parent may drive', () => {
  it('keeps its own, from the start given, where no value is given, and says each change', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useControlled<string | null>(undefined, 'first', onChange))
    expect(result.current[0]).toBe('first')
    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('shows the value given, and only says a change for the parent to make', () => {
    const onChange = vi.fn()
    const { result, rerender } = renderHook(({ value }) => useControlled(value, 'first', onChange), { initialProps: { value: 'given' } })
    const set = result.current[1]
    act(() => set('next'))
    expect(result.current[0]).toBe('given')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('next')
    rerender({ value: 'next' })
    expect(result.current[0]).toBe('next')
    // The setter stays the same one.
    expect(result.current[1]).toBe(set)
  })

  it('warns once a component changes between kept and driven, either way', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rerender } = renderHook(({ value }: { value: string | undefined }) => useControlled(value, 'first'), {
      initialProps: { value: undefined as string | undefined },
    })
    expect(warn).not.toHaveBeenCalled()
    rerender({ value: 'given' })
    expect(warn).toHaveBeenLastCalledWith('A component changed from uncontrolled to controlled. Decide once.')
    rerender({ value: 'other' })
    expect(warn).toHaveBeenCalledOnce()
    rerender({ value: undefined })
    expect(warn).toHaveBeenLastCalledWith('A component changed from controlled to uncontrolled. Decide once.')
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
