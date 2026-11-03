import { assert, describe, it } from '@effect/vitest'

import { allowedAnHour, capOf, easing, HOUR, LIST_EVERY, listEvery, makeSpending } from '../src/followBudget'
import { dueRank } from '../src/Follow'

/*
 * What following every open pull request may ask of a host (ADR-081): a fifth
 * of its hourly allowance, backing off as what is left falls, and the five
 * minutes between reads growing to fit.
 */

describe('what following may ask of a host', () => {
  it('is a fifth of what the host allows an hour: by its headers, else by what is usual for it', () => {
    assert.strictEqual(capOf('github', undefined), 1_000)
    assert.strictEqual(capOf('bitbucket_cloud', undefined), 200)
    assert.strictEqual(capOf('github', { counted: 0, limit: 15_000, remaining: 15_000 }), 3_000)
    // GitLab counts by the minute.
    assert.strictEqual(allowedAnHour('gitlab', { counted: 0, limit: 2_000 }), 120_000)
  })

  it('stops asking at the cap in any hour, and again as the hour passes', () => {
    const spending = makeSpending()
    const allowance = { counted: 0, limit: 100, remaining: 100 }
    // 100 an hour is 20 for following.
    assert.strictEqual(spending.room('c', 'github', allowance, 0), 20)
    spending.spend('c', 12, 1_000)
    spending.spend('c', 8, 60_000)
    assert.strictEqual(spending.room('c', 'github', allowance, 120_000), 0)
    // Another connection has its own.
    assert.strictEqual(spending.room('d', 'github', allowance, 120_000), 20)
    // The first twelve are an hour old.
    assert.strictEqual(spending.room('c', 'github', allowance, HOUR + 2_000), 12)
  })

  it('backs off as the allowance falls, and stops in the last of it', () => {
    const left = (remaining: number) => easing({ counted: 0, limit: 5_000, remaining }, 0)
    assert.deepStrictEqual([5_000, 2_500, 2_499, 1_500, 750, 250, 249, 100].map(left), [1, 1, 2, 2, 4, 8, Infinity, Infinity])
    // Nothing to back off from without headers.
    assert.strictEqual(easing(undefined, 0), 1)
    assert.strictEqual(easing({ counted: 40 }, 0), 1)
  })

  it('takes what the host said before its reset as out of date after it', () => {
    const spent = { counted: 0, limit: 5_000, remaining: 100, resetAt: new Date(HOUR).toISOString() }
    assert.strictEqual(easing(spent, HOUR - 1), Infinity)
    assert.strictEqual(easing(spent, HOUR), 1)
    assert.strictEqual(listEvery({ product: 'github', allowance: spent, cost: 3, shared: 1, now: HOUR + 1 }), LIST_EVERY)
  })

  it('reads the open list every five minutes, and slower when the pace would not fit the cap', () => {
    const base = { product: 'github' as const, allowance: undefined, shared: 1, now: 0 }
    assert.strictEqual(listEvery({ ...base, cost: 3 }), LIST_EVERY)
    // 30 checks reads and a list in one round of a repository, 1,000 an hour: 31 requests fit 32 times an hour, not 12.
    assert.strictEqual(listEvery({ ...base, cost: 31 }), LIST_EVERY)
    // Bitbucket Cloud: 200 an hour for following; 30 pull requests are 31 requests a round, so a round every 9.3 minutes.
    const bitbucket = listEvery({ product: 'bitbucket_cloud', allowance: undefined, cost: 31, shared: 1, now: 0 })
    assert.isAbove(bitbucket, LIST_EVERY)
    assert.closeTo(bitbucket, (HOUR * 31) / 200, 1)
    // Several repositories share a connection's cap.
    assert.isAbove(listEvery({ ...base, cost: 31, shared: 4 }), LIST_EVERY)
    // And the lower the allowance, the slower.
    assert.strictEqual(listEvery({ ...base, cost: 3, allowance: { counted: 0, limit: 5_000, remaining: 1_000 } }), LIST_EVERY * 4)
  })
})

describe('which followed pull requests are read', () => {
  const row = {
    headSha: 'a',
    checksSha: 'a',
    checksOutcome: 'passed' as 'passed' | 'failed' | 'running' | null,
    failedAt: null as string | null,
  }
  const at = (over: Partial<Parameters<typeof dueRank>[0]> = {}) =>
    dueRank({ row, awaitedDue: null, now: 10 * HOUR, polledAt: 10 * HOUR - 6 * 60_000, every: LIST_EVERY, ...over })

  it('reads one whose head moved, and one whose checks run, but not one whose checks passed', () => {
    assert.isNull(at())
    assert.strictEqual(at({ row: { ...row, headSha: 'b' } }), 1)
    assert.strictEqual(at({ row: { ...row, checksOutcome: 'running' } }), 1)
    assert.isNull(at({ row: { ...row, checksOutcome: 'running' }, polledAt: 10 * HOUR - 30_000 }))
  })

  it('reads one whose checks failed at an unchanged head for a day, at each list, and then no more', () => {
    const failed = { ...row, checksOutcome: 'failed' as const, failedAt: new Date(10 * HOUR).toISOString() }
    // Failed 22 hours ago, last read 6 minutes ago: due.
    assert.strictEqual(at({ row: failed, now: 32 * HOUR + 0, polledAt: 32 * HOUR - 6 * 60_000 }), 2)
    // Read a minute ago: not yet.
    assert.isNull(at({ row: failed, now: 32 * HOUR, polledAt: 32 * HOUR - 60_000 }))
    // Failed 25 hours ago: left until the person next asks.
    assert.isNull(at({ row: { ...failed, failedAt: new Date(0).toISOString() }, now: 25 * HOUR, polledAt: 25 * HOUR - 6 * 60_000 }))
  })

  it('reads one whose head has no checks again for half an hour only, for a check that starts late', () => {
    const none = { ...row, checksOutcome: null }
    const since = 10 * HOUR - 10 * 60_000
    assert.strictEqual(at({ row: none, emptySince: since }), 2)
    // Read a minute ago, or found empty over half an hour ago, or at a restart that remembers nothing: not read.
    assert.isNull(at({ row: none, emptySince: since, polledAt: 10 * HOUR - 60_000 }))
    assert.isNull(at({ row: none, emptySince: 10 * HOUR - 31 * 60_000 }))
    assert.isNull(at({ row: none }))
  })

  it('reads running checks less often as the host’s allowance falls', () => {
    const running = { ...row, checksOutcome: 'running' as const }
    assert.strictEqual(at({ row: running, polledAt: 10 * HOUR - 3 * 60_000 }), 1)
    assert.isNull(at({ row: running, polledAt: 10 * HOUR - 3 * 60_000, ease: 4 }))
  })

  it('reads one an errand waits on as a task’s own, ahead of the rest', () => {
    assert.strictEqual(at({ awaitedDue: true }), 0)
    assert.isNull(at({ awaitedDue: false, row: { ...row, headSha: 'b' } }))
  })
})
