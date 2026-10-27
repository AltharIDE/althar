import { describe, expect, it } from 'vite-plus/test'

import { AT, DIP, dawnAt, groundAt, LAPSE, lapseAt, shownAt, sunAt } from '../src/orbit/journey'

describe('the orbit’s clock', () => {
  it('runs at real speed at first, flat out by the sunrise, and calmer by day', () => {
    expect(lapseAt(0)).toBe(1)
    expect(lapseAt(AT.sunrise)).toBeCloseTo(LAPSE.most, 5)
    expect(lapseAt(20)).toBeCloseTo(LAPSE.day, 5)
  })

  it('shows as much time as its speed adds up to, worked out rather than summed', () => {
    const steps = 20000
    let sum = 0
    for (let i = 0; i < steps; i++) sum += lapseAt(((i + 0.5) * 9) / steps) * (9 / steps)
    expect(shownAt(9)).toBeCloseTo(sum, 2)
  })

  it('only ever moves the ground on', () => {
    let last = groundAt(0)
    for (let t = 0.05; t < 12; t += 0.05) {
      const next = groundAt(t)
      expect(next).toBeGreaterThan(last)
      last = next
    }
  })

  it('brings the sun over the limb at the sunrise, and not before', () => {
    expect(sunAt(AT.sunrise)).toBeCloseTo(-DIP, 6)
    expect(sunAt(AT.sunrise - 0.05)).toBeLessThan(-DIP)
    expect(sunAt(AT.sunrise + 0.05)).toBeGreaterThan(-DIP)
    expect(dawnAt(0)).toBe(0)
    expect(dawnAt(9)).toBe(1)
  })
})
