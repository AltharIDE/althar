import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchOnline } from '../src/main/online'

describe('watchOnline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says whether the computer is online at once, then only when that changes', () => {
    let online = true
    const told: Array<boolean> = []
    const stop = watchOnline(
      () => online,
      (now) => told.push(now),
      1_000,
    )
    vi.advanceTimersByTime(3_000)
    online = false
    vi.advanceTimersByTime(1_000)
    vi.advanceTimersByTime(5_000)
    online = true
    vi.advanceTimersByTime(1_000)
    expect(told).toEqual([true, false, true])
    stop()
    online = false
    vi.advanceTimersByTime(5_000)
    expect(told).toEqual([true, false, true])
  })
})
