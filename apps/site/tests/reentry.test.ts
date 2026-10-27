import { describe, expect, it } from 'vite-plus/test'

import { AT, brokenAt, flowAt, heatAt, shakeAt, speedAt } from '../src/reentry/journey'

describe('the re-entry’s clock', () => {
  it('builds the heat from a glow to its height, and loses it at the break', () => {
    expect(heatAt(0)).toBe(0)
    expect(heatAt(AT.ignite + 0.2)).toBeLessThan(0.2)
    expect(heatAt(AT.peak)).toBeCloseTo(1, 5)
    expect(heatAt(AT.broken)).toBe(0)
    expect(brokenAt(AT.break)).toBe(0)
    expect(brokenAt(AT.broken)).toBe(1)
  })

  it('streams the fire only ever on, faster as it heats', () => {
    let last = flowAt(0)
    for (let t = 0.05; t < 10; t += 0.05) {
      const next = flowAt(t)
      expect(next).toBeGreaterThan(last)
      last = next
    }
    expect(speedAt(AT.peak)).toBeGreaterThan(10 * speedAt(AT.ignite))
  })

  it('shakes hardest at the height and settles once it breaks', () => {
    expect(shakeAt(AT.peak)).toBeGreaterThan(shakeAt(AT.ignite + 1))
    expect(shakeAt(AT.broken + 1)).toBe(0)
  })
})
