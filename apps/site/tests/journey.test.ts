import { describe, expect, it } from 'vite-plus/test'

import { AT, distanceAt, lurchAt, pace, SPEED, speedAt, surge, whenPace } from '../src/train/journey'

describe('the train’s journey', () => {
  it('rolls slowly until it pulls, then gathers speed to flat out and holds it', () => {
    expect(speedAt(0)).toBeCloseTo(SPEED.slow)
    expect(speedAt(AT.pull)).toBeCloseTo(SPEED.slow)
    expect(speedAt(AT.flat)).toBeCloseTo(SPEED.fast)
    expect(speedAt(AT.flat + 60)).toBeCloseTo(SPEED.fast)
    for (let t = AT.pull; t < AT.flat; t += 0.05) expect(speedAt(t + 0.05)).toBeGreaterThanOrEqual(speedAt(t))
  })

  it('surges from nothing to all of it, never past either', () => {
    expect(surge(-1)).toBe(0)
    expect(surge(0)).toBe(0)
    expect(surge(1)).toBeCloseTo(1)
    expect(surge(2)).toBeCloseTo(1)
    expect(surge(0.25)).toBeLessThan(0.25)
  })

  it('reads how far it has gone from the clock: continuous, and the speed’s own sum', () => {
    expect(distanceAt(0)).toBe(0)
    expect(distanceAt(AT.pull)).toBeCloseTo(SPEED.slow * AT.pull)
    for (const t of [AT.pull + 0.5, (AT.pull + AT.flat) / 2, AT.flat, AT.flat + 3]) {
      const h = 1e-3
      expect((distanceAt(t + h) - distanceAt(t - h)) / (2 * h)).toBeCloseTo(speedAt(t), 0)
    }
    expect(distanceAt(AT.flat + 10) - distanceAt(AT.flat)).toBeCloseTo(SPEED.fast * 10)
  })

  it('finds the second the train is a share of the way to flat out', () => {
    expect(pace(0)).toBe(0)
    expect(pace(AT.flat + 1)).toBeCloseTo(1)
    const half = whenPace(0.5)
    expect(half).toBeGreaterThan(AT.pull)
    expect(half).toBeLessThan(AT.flat)
    expect(pace(half)).toBeCloseTo(0.5, 3)
  })

  it('lurches only as it pulls away, and settles', () => {
    expect(lurchAt(AT.pull - 0.1)).toBe(0)
    expect(Math.abs(lurchAt(AT.pull + 0.2))).toBeGreaterThan(0.2)
    expect(lurchAt(AT.pull + 2)).toBe(0)
  })
})
