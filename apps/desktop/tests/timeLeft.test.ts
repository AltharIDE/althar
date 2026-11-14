import { describe, expect, it } from 'vitest'

import { clock, timeLeft } from '../src/renderer/shared/time'

const NOW = new Date('2026-10-15T10:00:00.000Z')
const after = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

describe('how long until a reset', () => {
  it('counts minutes under an hour, rounded up so it never says 0 before the reset', () => {
    expect(timeLeft(after(1_000), NOW)).toBe('in 1m')
    expect(timeLeft(after(45 * MIN), NOW)).toBe('in 45m')
    expect(timeLeft(after(59 * MIN + 1_000), NOW)).toBe('in 1h')
  })

  it('counts hours and minutes under a day', () => {
    expect(timeLeft(after(HOUR), NOW)).toBe('in 1h')
    expect(timeLeft(after(2 * HOUR + 10 * MIN), NOW)).toBe('in 2h 10m')
    expect(timeLeft(after(23 * HOUR + 59 * MIN), NOW)).toBe('in 23h 59m')
  })

  it('counts days and hours from a day', () => {
    expect(timeLeft(after(24 * HOUR), NOW)).toBe('in 1d')
    expect(timeLeft(after(24 * HOUR + 30 * MIN), NOW)).toBe('in 1d')
    expect(timeLeft(after(27 * HOUR), NOW)).toBe('in 1d 3h')
    expect(timeLeft(after(4 * 24 * HOUR + 2 * HOUR), NOW)).toBe('in 4d 2h')
  })

  it('says nothing for a time now or past, or one that is not a time', () => {
    expect(timeLeft(NOW.toISOString(), NOW)).toBeNull()
    expect(timeLeft(after(-5 * MIN), NOW)).toBeNull()
    expect(timeLeft('', NOW)).toBeNull()
  })
})

describe('a clock for a time past', () => {
  it('gives the date of a past time, which a weekday would read as the coming one', () => {
    const past = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(clock(past, NOW)).toBe(
      `${new Date(past).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${new Date(past).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    )
    const ahead = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(clock(ahead, NOW)).toBe(
      `${new Date(ahead).toLocaleDateString(undefined, { weekday: 'short' })} ${new Date(ahead).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    )
  })
})
