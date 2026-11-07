import { assert, describe, it } from '@effect/vitest'
import { Duration } from 'effect'

import { EARLIEST_BY, endingOf, WARN_WITHIN, warnedKey, warnedOf, warning } from '../src/signInEnding'

/*
 * When an agent's sign-in ends, and the one warning Althar raises about it
 * (DEV-196): only within its last days (three before the earliest it can
 * end), and once at each stage of a sign-in's end.
 */

const now = Date.parse('2026-11-07T12:00:00.000Z')
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString()

describe('when a sign-in ends', () => {
  it('is far off, within the warning’s days, any day now past the earliest it can end, or past', () => {
    assert.strictEqual(endingOf(hours(24 * 10), now), 'later')
    assert.strictEqual(endingOf(hours(24 * 6 + 1), now), 'later')
    assert.strictEqual(endingOf(hours(24 * 6), now), 'soon')
    assert.strictEqual(endingOf(hours(24 * 3 + 1), now), 'soon')
    assert.strictEqual(endingOf(hours(24 * 3), now), 'last')
    assert.strictEqual(endingOf(hours(1), now), 'last')
    assert.strictEqual(endingOf(hours(0), now), 'ended')
    assert.strictEqual(endingOf(hours(-5), now), 'ended')
  })

  it('has ended once its check says signed out within the warning’s days, and not before them', () => {
    assert.strictEqual(endingOf(hours(24 * 5), now, true), 'ended')
    assert.strictEqual(endingOf(hours(24 * 2), now, true), 'ended')
    // Signed out months before its end is the person's own sign-out: not this warning's.
    assert.strictEqual(endingOf(hours(24 * 30), now, true), 'later')
  })

  it('says nothing of an end that isn’t given, or isn’t a time', () => {
    assert.isUndefined(endingOf(undefined, now))
    assert.isUndefined(endingOf('next Tuesday', now))
  })

  it('warns three days before the earliest it can end: six before the date Claude Code gives, which can be three days late', () => {
    assert.strictEqual(Duration.toMillis(WARN_WITHIN), 6 * 24 * 3_600_000)
    assert.strictEqual(Duration.toMillis(EARLIEST_BY), 3 * 24 * 3_600_000)
  })
})

describe('the warning', () => {
  it('is raised only within the last days, and stays once the sign-in has ended', () => {
    assert.isUndefined(warning(hours(24 * 7), undefined, now))
    assert.strictEqual(warning(hours(24 * 5), undefined, now), 'soon')
    assert.strictEqual(warning(hours(24 * 2), undefined, now), 'last')
    assert.strictEqual(warning(hours(-1), undefined, now), 'ended')
    assert.isUndefined(warning(undefined, undefined, now))
  })

  it('put aside, stays aside until its next stage, so a dismissal days out still leaves the last days and the end', () => {
    const endsAt = hours(24 * 5)
    const day = 24 * 3_600_000
    const soon = { endsAt, dismissed: 'soon' as const }
    assert.isUndefined(warning(endsAt, soon, now))
    assert.isUndefined(warning(endsAt, soon, now + day))
    assert.strictEqual(warning(endsAt, soon, now + 2 * day + 1), 'last')
    assert.strictEqual(warning(endsAt, soon, now + 6 * day), 'ended')
    const last = { endsAt, dismissed: 'last' as const }
    assert.isUndefined(warning(endsAt, last, now + 3 * day))
    assert.strictEqual(warning(endsAt, last, now + 6 * day), 'ended')
    // A signed-out check ends it early: that is raised past a dismissal at an earlier stage too.
    assert.strictEqual(warning(endsAt, soon, now, true), 'ended')
    const ended = { endsAt, dismissed: 'ended' as const }
    assert.isUndefined(warning(endsAt, ended, now + 6 * day))
    assert.isUndefined(warning(endsAt, ended, now, true))
  })

  it('is raised again for a new sign-in, once that one nears its own end', () => {
    const aside = { endsAt: hours(30), dismissed: 'ended' as const }
    // Signed in again: a new end, a month off, says nothing yet; within its own last days, it warns.
    const next = hours(24 * 30)
    assert.isUndefined(warning(next, aside, now))
    assert.strictEqual(warning(next, aside, now + 24 * 25 * 3_600_000), 'soon')
  })

  it('is kept by account, and read back only when it is one', () => {
    assert.strictEqual(warnedKey('acc_1'), 'sign_in_ending:acc_1')
    assert.deepStrictEqual(warnedOf(JSON.stringify({ endsAt: hours(1), dismissed: 'last' })), { endsAt: hours(1), dismissed: 'last' })
    // Kept before stages were: put aside at the first.
    assert.deepStrictEqual(warnedOf(JSON.stringify({ endsAt: hours(1), dismissed: true })), { endsAt: hours(1), dismissed: 'soon' })
    assert.isUndefined(warnedOf(undefined))
    assert.isUndefined(warnedOf('not json'))
    assert.isUndefined(warnedOf('null'))
    assert.isUndefined(warnedOf(JSON.stringify({ endsAt: 5, dismissed: 'soon' })))
    assert.isUndefined(warnedOf(JSON.stringify({ endsAt: hours(1), dismissed: 'tomorrow' })))
  })
})
