import { describe, expect, it } from 'vitest'

import { timeLeft } from '../src/renderer/shared/time'

const NOW = new Date('2026-10-15T10:00:00.000Z')
const after = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

describe('how long until a reset', () => {
  it('counts minutes under an hour, rounded up so it never says 0 before the reset', () => {
    expect(timeLeft(after(1_000), NOW)).toBe('in 1 m')
    expect(timeLeft(after(45 * MIN), NOW)).toBe('in 45 m')
    expect(timeLeft(after(59 * MIN + 1_000), NOW)).toBe('in 1 h')
  })

  it('counts hours and minutes under a day', () => {
    expect(timeLeft(after(HOUR), NOW)).toBe('in 1 h')
    expect(timeLeft(after(2 * HOUR + 10 * MIN), NOW)).toBe('in 2 h 10 m')
    expect(timeLeft(after(23 * HOUR + 59 * MIN), NOW)).toBe('in 23 h 59 m')
  })

  it('counts days and hours from a day', () => {
    expect(timeLeft(after(24 * HOUR), NOW)).toBe('in 1 d')
    expect(timeLeft(after(24 * HOUR + 30 * MIN), NOW)).toBe('in 1 d')
    expect(timeLeft(after(27 * HOUR), NOW)).toBe('in 1 d 3 h')
    expect(timeLeft(after(4 * 24 * HOUR + 2 * HOUR), NOW)).toBe('in 4 d 2 h')
  })

  it('says nothing for a time now or past, or one that is not a time', () => {
    expect(timeLeft(NOW.toISOString(), NOW)).toBeNull()
    expect(timeLeft(after(-5 * MIN), NOW)).toBeNull()
    expect(timeLeft('', NOW)).toBeNull()
  })
})
