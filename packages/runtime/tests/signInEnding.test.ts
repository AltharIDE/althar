import { assert, describe, it } from '@effect/vitest'
import { Duration } from 'effect'

import { endingOf, WARN_WITHIN, warnedKey, warnedOf, warns } from '../src/signInEnding'

/*
 * When an agent's sign-in ends, and the one warning Althar raises about it
 * (DEV-196): only within its last days (three before the earliest it can
 * end), and once for each sign-in.
 */

const now = Date.parse('2026-11-07T12:00:00.000Z')
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString()

describe('when a sign-in ends', () => {
  it('is far off, within the warning’s days, or past', () => {
    assert.strictEqual(endingOf(hours(24 * 10), now), 'later')
    assert.strictEqual(endingOf(hours(24 * 6 + 1), now), 'later')
    assert.strictEqual(endingOf(hours(24 * 6), now), 'soon')
    assert.strictEqual(endingOf(hours(1), now), 'soon')
    assert.strictEqual(endingOf(hours(0), now), 'ended')
    assert.strictEqual(endingOf(hours(-5), now), 'ended')
  })

  it('says nothing of an end that isn’t given, or isn’t a time', () => {
    assert.isUndefined(endingOf(undefined, now))
    assert.isUndefined(endingOf('next Tuesday', now))
  })

  it('warns three days before the earliest it can end: six before the date Claude Code gives, which can be three days late', () => {
    assert.strictEqual(Duration.toMillis(WARN_WITHIN), 6 * 24 * 3_600_000)
  })
})

describe('the warning', () => {
  it('is raised only within the last days, and stays once the sign-in has ended', () => {
    assert.isFalse(warns(hours(24 * 7), undefined, now))
    assert.isTrue(warns(hours(24 * 5), undefined, now))
    assert.isTrue(warns(hours(-1), undefined, now))
    assert.isFalse(warns(undefined, undefined, now))
  })

  it('put aside, is not raised again for the same sign-in, before or after it ends', () => {
    const endsAt = hours(30)
    const aside = { endsAt, dismissed: true }
    assert.isFalse(warns(endsAt, aside, now))
    assert.isFalse(warns(endsAt, aside, now + 40 * 3_600_000))
  })

  it('is raised again for a new sign-in, once that one nears its own end', () => {
    const aside = { endsAt: hours(30), dismissed: true }
    // Signed in again: a new end, a month off, says nothing yet; within its own last days, it warns.
    const next = hours(24 * 30)
    assert.isFalse(warns(next, aside, now))
    assert.isTrue(warns(next, aside, now + 24 * 25 * 3_600_000))
  })

  it('is kept by account, and read back only when it is one', () => {
    assert.strictEqual(warnedKey('acc_1'), 'sign_in_ending:acc_1')
    assert.deepStrictEqual(warnedOf(JSON.stringify({ endsAt: hours(1), dismissed: true })), { endsAt: hours(1), dismissed: true })
    assert.isUndefined(warnedOf(undefined))
    assert.isUndefined(warnedOf('not json'))
    assert.isUndefined(warnedOf('null'))
    assert.isUndefined(warnedOf(JSON.stringify({ endsAt: 5, dismissed: true })))
  })
})
