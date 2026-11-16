// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { EVERY_MS, framesIn, type Lag, lagOf, watchLag } from '../src/main/lag'

/** A schedule the test runs by hand: `tick()` is one window over. */
const byHand = () => {
  let tick: (() => void) | undefined
  let every: number | undefined
  return {
    schedule: (given: () => void, ms: number) => {
      tick = given
      every = ms
      return () => {
        tick = undefined
      }
    },
    tick: () => tick?.(),
    every: () => every,
    running: () => tick !== undefined,
  }
}

describe('how late the main process’s thread ran', () => {
  it('says each window in which it ran more than 100 ms late, and nothing of one that didn’t', () => {
    const windows: Array<Lag> = [
      { maxMs: 40, p99Ms: 30, meanMs: 5 },
      { maxMs: 340.5, p99Ms: 300, meanMs: 12 },
      { maxMs: 100, p99Ms: 90, meanMs: 4 },
    ]
    const said: Array<Lag> = []
    const clock = byHand()
    const stop = watchLag((lag) => said.push(lag), {
      read: () => windows.shift() ?? { maxMs: 0, p99Ms: 0, meanMs: 0 },
      schedule: clock.schedule,
    })
    expect(clock.every()).toBe(EVERY_MS)
    clock.tick()
    clock.tick()
    clock.tick()
    expect(said).toEqual([{ maxMs: 340.5, p99Ms: 300, meanMs: 12 }])
    stop()
    expect(clock.running()).toBe(false)
  })

  it('reads the loop’s own histogram, in milliseconds, by default, and stops reading it', () => {
    const clock = byHand()
    const said: Array<Lag> = []
    const stop = watchLag((lag) => said.push(lag), { schedule: clock.schedule, late: -1 })
    clock.tick()
    expect(said).toHaveLength(1)
    expect(said[0]?.maxMs).toBeGreaterThanOrEqual(0)
    stop()
  })

  it('reads a window of the histogram in milliseconds, a mean of none as nothing', () => {
    expect(lagOf({ max: 250_000_000, mean: 12_340_000, percentile: () => 180_000_000 })).toEqual({ maxMs: 250, p99Ms: 180, meanMs: 12.3 })
    expect(lagOf({ max: 0, mean: Number.NaN, percentile: () => 0 })).toEqual({ maxMs: 0, p99Ms: 0, meanMs: 0 })
  })

  it('watches by its own timer, which keeps no process open', () => {
    const stop = watchLag(() => undefined)
    stop()
  })
})

describe('the window’s slow frames, as main takes them', () => {
  it('keeps what frames.ts sends, in the words it may use', () => {
    expect(
      framesIn({
        frames: [
          { kind: 'frame', ms: 180.4, blockingMs: 90, script: 'BUTTON#send.onclick:index-abc.js:send' },
          { kind: 'press', ms: 240, event: 'click', on: 'button.send' },
          { kind: 'task', ms: 130 },
        ],
        more: 2,
      }),
    ).toEqual({
      frames: [
        { kind: 'frame', ms: 180, blockingMs: 90, script: 'BUTTON#send.onclick:index-abc.js:send' },
        { kind: 'press', ms: 240, event: 'click', on: 'button.send' },
        { kind: 'task', ms: 130 },
      ],
      more: 2,
    })
  })

  it('drops anything else: words a person may have written, other kinds, and what isn’t a time', () => {
    expect(
      framesIn({
        frames: [
          { kind: 'press', ms: 200, event: 'click', on: 'Fix the login bug for dana@example.com' },
          { kind: 'paint', ms: 200 },
          { kind: 'frame', ms: -1 },
          { kind: 'frame', ms: Number.POSITIVE_INFINITY },
          { kind: 'frame', ms: '200' },
          null,
          'frame',
          { kind: 'frame', ms: 9_999_999, blockingMs: 'a lot' },
        ],
      }),
    ).toEqual({
      frames: [
        { kind: 'press', ms: 200, event: 'click' },
        { kind: 'frame', ms: 600_000 },
      ],
      more: 0,
    })
    for (const said of [null, 'frames', 7, {}, { frames: 'none' }]) expect(framesIn(said)).toBeNull()
  })

  it('takes twenty at most, counting the rest', () => {
    const frames = Array.from({ length: 25 }, () => ({ kind: 'task', ms: 120 }))
    const batch = framesIn({ frames, more: 3 })
    expect(batch?.frames).toHaveLength(20)
    expect(batch?.more).toBe(8)
  })
})
