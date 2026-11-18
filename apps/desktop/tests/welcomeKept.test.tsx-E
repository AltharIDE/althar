import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { markToured, toured, useWelcoming, welcome } from '../src/renderer/features/start/welcome'

/*
 * What the welcome keeps: whether it is on show, for as long as the window
 * lives, and whether its tour was seen, in storage, which may refuse.
 */

afterEach(() => vi.restoreAllMocks())

describe('what the welcome keeps', () => {
  it('is on show from its beginning to its end, and says so to whoever watches', () => {
    const { result } = renderHook(() => useWelcoming())
    expect(result.current).toBe(false)
    act(() => welcome.begin())
    expect(result.current).toBe(true)
    expect(welcome.isShowing()).toBe(true)
    act(() => welcome.end())
    expect(result.current).toBe(false)
  })

  it('keeps the tour seen, and counts it unseen where storage can’t be read, showing it once more where it can’t be written', () => {
    expect(toured()).toBe(false)
    markToured()
    expect(toured()).toBe(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(toured()).toBe(false)
    expect(() => markToured()).not.toThrow()
  })
})
