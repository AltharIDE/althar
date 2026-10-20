import type { Schedule } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { instantOf, lastCome, localOf, MOST_STAGGER, nextToCome, slotAfter, slotAtOrBefore, staggerOf, windowOf } from '../src/slots'
import { Duration } from 'effect'

const WEEKDAYS: Schedule = { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' }
const NIGHTLY: Schedule = { every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '02:00' }
const HOURLY: Schedule = { every: 'hour', minute: 15 }
const LONDON = 'Europe/London'
const HOUR = 3_600_000

/** An instant, from a UTC time. */
const utc = (iso: string) => Date.parse(`${iso}Z`)

describe('slots', () => {
  it('finds the next slot on the days it names', () => {
    // 21 October 2026 is a Wednesday.
    assert.strictEqual(slotAfter(WEEKDAYS, '2026-10-21T08:59'), '2026-10-21T09:00')
    assert.strictEqual(slotAfter(WEEKDAYS, '2026-10-21T09:00'), '2026-10-22T09:00')
    // Friday after 9 goes to Monday.
    assert.strictEqual(slotAfter(WEEKDAYS, '2026-10-23T10:00'), '2026-10-26T09:00')
    // Across a month and a year.
    assert.strictEqual(slotAfter(NIGHTLY, '2026-12-31T03:00'), '2027-01-01T02:00')
  })

  it('finds the last slot at or before a time', () => {
    assert.strictEqual(slotAtOrBefore(WEEKDAYS, '2026-10-21T09:00'), '2026-10-21T09:00')
    assert.strictEqual(slotAtOrBefore(WEEKDAYS, '2026-10-21T08:59'), '2026-10-20T09:00')
    // Monday morning before 9 goes back to Friday.
    assert.strictEqual(slotAtOrBefore(WEEKDAYS, '2026-10-26T08:00'), '2026-10-23T09:00')
  })

  it('runs every hour at its minute', () => {
    assert.strictEqual(slotAfter(HOURLY, '2026-10-21T09:14'), '2026-10-21T09:15')
    assert.strictEqual(slotAfter(HOURLY, '2026-10-21T09:15'), '2026-10-21T10:15')
    assert.strictEqual(slotAfter(HOURLY, '2026-10-21T23:30'), '2026-10-22T00:15')
    assert.strictEqual(slotAtOrBefore(HOURLY, '2026-10-21T09:14'), '2026-10-21T08:15')
    assert.strictEqual(slotAtOrBefore(HOURLY, '2026-10-22T00:10'), '2026-10-21T23:15')
  })

  it('reads a slot in a zone, and an instant back', () => {
    // London is on summer time in October until the 25th.
    assert.strictEqual(instantOf('2026-10-21T09:00', LONDON), utc('2026-10-21T08:00'))
    assert.strictEqual(localOf(utc('2026-10-21T08:00'), LONDON), '2026-10-21T09:00')
    assert.strictEqual(instantOf('2026-11-02T09:00', LONDON), utc('2026-11-02T09:00'))
    assert.strictEqual(instantOf('2026-10-21T09:00', 'America/New_York'), utc('2026-10-21T13:00'))
  })

  it('runs a time daylight saving skips an hour later, and one it repeats the first time', () => {
    // London's clocks go forward at 1:00 on 29 March 2026: 1:30 never happens, so it comes at 2:30 summer time.
    assert.strictEqual(instantOf('2026-03-29T01:30', LONDON), utc('2026-03-29T01:30'))
    assert.strictEqual(localOf(instantOf('2026-03-29T01:30', LONDON), LONDON), '2026-03-29T02:30')
    // They go back at 2:00 on 25 October 2026: 1:30 happens twice, and it comes the first time, on summer time.
    assert.strictEqual(instantOf('2026-10-25T01:30', LONDON), utc('2026-10-25T00:30'))
  })

  it('brings a repeated time once', () => {
    const atHalfPast: Schedule = { every: 'week', days: [7], at: '01:30' }
    // The first 1:30 has come by 0:45 UTC; at the second 1:30 (1:30 UTC), the next to come is a week on, not again.
    assert.strictEqual(lastCome(atHalfPast, utc('2026-10-25T00:45'), LONDON), '2026-10-25T01:30')
    assert.strictEqual(nextToCome(atHalfPast, utc('2026-10-25T01:31'), LONDON), '2026-11-01T01:30')
  })

  it('says which slot has come last, and which is next', () => {
    const at = utc('2026-10-21T08:30') // 9:30 in London
    assert.strictEqual(lastCome(WEEKDAYS, at, LONDON), '2026-10-21T09:00')
    assert.strictEqual(nextToCome(WEEKDAYS, at, LONDON), '2026-10-22T09:00')
    // Before 9 in London, 9:00 hasn't come.
    assert.strictEqual(lastCome(WEEKDAYS, utc('2026-10-21T07:59'), LONDON), '2026-10-20T09:00')
    assert.strictEqual(nextToCome(WEEKDAYS, utc('2026-10-21T07:59'), LONDON), '2026-10-21T09:00')
  })

  it('counts the stagger: a slot comes only once its few minutes after have passed', () => {
    const stagger = 3 * 60_000
    assert.strictEqual(lastCome(WEEKDAYS, utc('2026-10-21T08:02'), LONDON, stagger), '2026-10-20T09:00')
    assert.strictEqual(lastCome(WEEKDAYS, utc('2026-10-21T08:03'), LONDON, stagger), '2026-10-21T09:00')
    assert.strictEqual(nextToCome(WEEKDAYS, utc('2026-10-21T08:02'), LONDON, stagger), '2026-10-21T09:00')
  })

  it('keeps 9:00 where the Mac is: a day the clock skips comes once, in the new zone', () => {
    // Asleep in London on Tuesday evening, awake in New York: Wednesday's 9:00 is 9:00 there.
    assert.strictEqual(nextToCome(WEEKDAYS, utc('2026-10-20T20:00'), 'America/New_York'), '2026-10-21T09:00')
    assert.strictEqual(instantOf('2026-10-21T09:00', 'America/New_York'), utc('2026-10-21T13:00'))
  })

  it('lets a slot start late by half the time to the next, at most twelve hours', () => {
    // A weekday 9:00 runs until 14:00 at most, Friday's too.
    assert.strictEqual(windowOf(WEEKDAYS, '2026-10-21T09:00', LONDON), 12 * HOUR)
    assert.strictEqual(windowOf(WEEKDAYS, '2026-10-23T09:00', LONDON), 12 * HOUR)
    // An hourly one, half an hour.
    assert.strictEqual(windowOf(HOURLY, '2026-10-21T09:15', LONDON), HOUR / 2)
    // A Monday-only one, twelve hours still.
    assert.strictEqual(windowOf({ every: 'week', days: [1], at: '09:00' }, '2026-10-19T09:00', LONDON), 12 * HOUR)
  })

  it('staggers each automation by the same few minutes every time', () => {
    const a = staggerOf('auto_0192f0a0000070008000000000000001')
    assert.strictEqual(staggerOf('auto_0192f0a0000070008000000000000001'), a)
    assert.isAtMost(a, Duration.toMillis(MOST_STAGGER))
    const spread = new Set(Array.from({ length: 40 }, (_, i) => staggerOf(`auto_${String(i).padStart(32, '0')}`)))
    assert.isAbove(spread.size, 10)
  })
})
