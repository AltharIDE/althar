import { describe, expect, it } from 'vite-plus/test'

import {
  altitudeAfter,
  altitudeAt,
  AT,
  brokenAt,
  driftAt,
  flowAt,
  heatAt,
  shakeAt,
  speedAt,
  swayAt,
  velocityAfter,
  velocityAt,
} from '../src/home/hero/journey'
import { TALL, WIDE } from '../src/home/hero/plate'

describe('the first screen’s clock', () => {
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
    for (let t = 0.05; t < AT.settled; t += 0.05) {
      const next = flowAt(t)
      expect(next).toBeGreaterThan(last)
      last = next
    }
    expect(speedAt(AT.peak)).toBeGreaterThan(10 * speedAt(AT.ignite))
  })

  it('shakes hardest at the height and is still once it breaks', () => {
    expect(shakeAt(AT.peak)).toBeGreaterThan(shakeAt(AT.ignite + 1))
    expect(shakeAt(AT.broken + 1)).toBe(0)
  })

  it('comes to rest by the last frame, so nothing needs drawing after it', () => {
    expect(swayAt(AT.settled)).toBe(0)
    expect(driftAt(AT.settled)).toBe(driftAt(AT.settled + 60))
    // Its last moment of drift is already near still.
    expect(driftAt(AT.settled) - driftAt(AT.settled - 0.1)).toBeLessThan(0.05)
  })

  it('reads the capsule only ever slowing and falling, from orbit to rest', () => {
    expect(velocityAt(0)).toBeCloseTo(7.8, 5)
    expect(altitudeAt(0)).toBeCloseTo(122, 5)
    for (let t = 0.05; t < AT.settled; t += 0.05) {
      expect(velocityAt(t)).toBeLessThanOrEqual(velocityAt(t - 0.05))
      expect(altitudeAt(t)).toBeLessThanOrEqual(altitudeAt(t - 0.05))
    }
    // Still fast at the fire's height, as "fast." is forged; slow under the sky.
    expect(velocityAt(AT.peak)).toBeGreaterThan(6)
    expect(velocityAt(AT.settled)).toBeLessThan(0.5)
    expect(velocityAt(AT.settled)).toBe(velocityAt(AT.settled + 60))
    expect(altitudeAt(AT.settled)).toBe(altitudeAt(AT.settled + 60))
  })

  it('goes on reading at rest: from where the journey left off, sinking slowly and never jumping', () => {
    expect(velocityAfter(0)).toBe(velocityAt(AT.settled))
    expect(altitudeAfter(0)).toBe(altitudeAt(AT.settled))
    // A reading a quarter of a second after the last is never far from it.
    for (let s = 0.25; s < 1200; s += 0.25) {
      expect(Math.abs(velocityAfter(s) - velocityAfter(s - 0.25))).toBeLessThan(0.005)
      expect(Math.abs(altitudeAfter(s) - altitudeAfter(s - 0.25))).toBeLessThan(0.01)
      expect(velocityAfter(s)).toBeGreaterThan(0.18)
      expect(velocityAfter(s)).toBeLessThan(0.25)
      expect(altitudeAfter(s)).toBeGreaterThan(33)
    }
    // Falling, slower each minute, and still moving after a long while.
    expect(altitudeAfter(60)).toBeLessThan(altitudeAfter(0))
    expect(altitudeAfter(600)).toBeLessThan(altitudeAfter(60))
    expect(altitudeAfter(60) - altitudeAfter(120)).toBeGreaterThan(altitudeAfter(600) - altitudeAfter(660))
  })

  it('never drifts the sky past the edge of its picture, on either photograph', () => {
    for (const plate of [WIDE, TALL]) {
      const drift = driftAt(AT.settled) * plate.unit
      // The window's right edge, drifted, and a margin for the heat's shimmer, still inside the sky picture.
      expect(plate.window.x + plate.window.w + drift + 26 * plate.unit).toBeLessThan(plate.sky.x + plate.sky.w)
      expect(plate.sky.x).toBeLessThanOrEqual(plate.window.x)
      expect(plate.sky.y).toBeLessThan(plate.window.y)
      expect(plate.sky.y + plate.sky.h).toBeGreaterThan(plate.window.y + plate.window.h)
    }
  })
})
