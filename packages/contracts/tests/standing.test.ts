import { describe, expect, it } from 'vitest'

import type { ChangeSummary, ChecksSummary } from '../src/Api'
import { forShip, goingUp, isBlocked, personPushes, pushResolves, ranChecks, standingOf } from '../src/standing'

/*
 * What stands between a ready change's open pull request and merging it, the
 * one reading every place takes: the window's words, the board's Needs you
 * and the runtime's notifications (`waiting.ts`) all start from `standingOf`.
 */

const checks = (over: Partial<ChecksSummary> = {}): ChecksSummary => ({
  outcome: 'passed',
  passed: 2,
  failed: 0,
  running: 0,
  total: 2,
  failing: [],
  list: [
    { name: 'test', state: 'passed', summary: null },
    { name: 'lint', state: 'passed', summary: null },
  ],
  ...over,
})

const change = (over: Partial<ChangeSummary> = {}) =>
  ({
    state: 'open',
    draft: false,
    queued: false,
    conflicts: false,
    target: 'main',
    diverged: null,
    localHead: null,
    unpushed: 0,
    checks: checks(),
    ...over,
  }) as unknown as ChangeSummary

describe('where a change stands', () => {
  it('is ready to merge with nothing in its way', () => {
    const standing = standingOf(change())
    expect(standing).toEqual({ blockers: [], next: { kind: 'merge' } })
    expect(isBlocked(standing)).toBe(false)
    expect(pushResolves(standing)).toBe(false)
  })

  it('puts a branch that has parted first, and leaves the next thing to the task', () => {
    const standing = standingOf(change({ diverged: { kind: 'rewritten', local: 2, onPullRequest: 1 }, localHead: 'def456', unpushed: 2 }))
    expect(standing).toEqual({ blockers: [{ kind: 'parted' }], next: null })
    expect(isBlocked(standing)).toBe(true)
  })

  it('counts commits not on the pull request only once the head here is known, and offers them as a Push', () => {
    expect(standingOf(change({ localHead: null, unpushed: 3 })).blockers).toEqual([])
    const standing = standingOf(change({ localHead: 'def456', unpushed: 3 }))
    expect(standing).toEqual({ blockers: [{ kind: 'unpushed', commits: 3, held: null }], next: { kind: 'push', commits: 3 } })
    expect(isBlocked(standing)).toBe(false)
  })

  it('says why commits were held where the project pushes them on its own, and offers them as a Push (ADR-072)', () => {
    const held = change({ localHead: 'def456', unpushed: 1, pushing: { held: 'the push was refused' } } as Partial<ChangeSummary>)
    expect(personPushes(held)).toBe(true)
    expect(goingUp(held)).toBe(false)
    expect(standingOf(held).blockers).toEqual([{ kind: 'unpushed', commits: 1, held: 'the push was refused' }])
  })

  it('offers nothing for commits going up on their own, nor blocks on them (ADR-072)', () => {
    const going = change({ localHead: 'def456', unpushed: 2, pushing: { held: null } } as Partial<ChangeSummary>)
    expect(personPushes(going)).toBe(false)
    expect(goingUp(going)).toBe(true)
    expect(forShip(going)).toBe(false)
    const standing = standingOf(going)
    expect(standing).toEqual({ blockers: [{ kind: 'going', commits: 2 }], next: null })
    expect(isBlocked(standing)).toBe(false)
  })

  it('leaves commits held for Ship to Ship: no Push, and not going up', () => {
    const shipping = change({ localHead: 'def456', unpushed: 1, pushing: { held: null, ship: true } } as Partial<ChangeSummary>)
    expect(forShip(shipping)).toBe(true)
    expect(personPushes(shipping)).toBe(false)
    expect(goingUp(shipping)).toBe(false)
    const standing = standingOf(shipping)
    expect(standing).toEqual({ blockers: [{ kind: 'shipping', commits: 1 }], next: null })
    expect(isBlocked(standing)).toBe(false)
  })

  it('asks for a conflict to be resolved, by its target where known, and is blocked by it', () => {
    const standing = standingOf(change({ conflicts: true, target: 'release' }))
    expect(standing).toEqual({ blockers: [{ kind: 'conflict', target: 'release' }], next: { kind: 'resolve' } })
    expect(isBlocked(standing)).toBe(true)
    expect(standingOf(change({ conflicts: true, target: undefined } as Partial<ChangeSummary>)).blockers).toEqual([
      { kind: 'conflict', target: null },
    ])
  })

  it('takes commits beside a conflict to be what resolves it, whichever way they go up', () => {
    for (const pushing of [undefined, { held: null }, { held: null, ship: true }]) {
      const standing = standingOf(change({ conflicts: true, localHead: 'def456', unpushed: 1, pushing } as Partial<ChangeSummary>))
      expect(pushResolves(standing)).toBe(true)
      expect(isBlocked(standing)).toBe(false)
    }
  })

  it('asks for failed checks to be fixed, and is blocked by them', () => {
    const standing = standingOf(change({ checks: checks({ outcome: 'failed', passed: 1, failed: 1, failing: ['test'] }) }))
    expect(standing).toEqual({ blockers: [{ kind: 'failed', failing: ['test'], failed: 1 }], next: { kind: 'fix', failing: ['test'] } })
    expect(isBlocked(standing)).toBe(true)
  })

  it('waits on running checks, leaving skipped ones out of the counts', () => {
    const running = checks({
      outcome: 'running',
      passed: 1,
      running: 1,
      total: 3,
      list: [
        { name: 'test', state: 'passed', summary: null },
        { name: 'lint', state: 'running', summary: null },
        { name: 'docs', state: 'skipped', summary: null },
      ],
    })
    expect(ranChecks(running)).toEqual({ passed: 1, total: 2 })
    const standing = standingOf(change({ checks: running }))
    expect(standing).toEqual({ blockers: [{ kind: 'running', passed: 1, total: 2 }], next: null })
    expect(isBlocked(standing)).toBe(false)
    // Run again by Althar, a cancelled check runs before its host says so: the outcome alone says running.
    expect(standingOf(change({ checks: checks({ outcome: 'running' }) })).blockers).toEqual([{ kind: 'running', passed: 2, total: 2 }])
  })

  it('holds on cancelled checks once the rest are done', () => {
    const cancelled = checks({
      list: [
        { name: 'test', state: 'passed', summary: null },
        { name: 'lint', state: 'cancelled', summary: null },
      ],
    })
    const standing = standingOf(change({ checks: cancelled }))
    expect(standing).toEqual({ blockers: [{ kind: 'cancelled', cancelled: ['lint'] }], next: null })
    expect(isBlocked(standing)).toBe(true)
  })

  it('reads a change with no checks yet as nothing in the way', () => {
    expect(standingOf(change({ checks: null }))).toEqual({ blockers: [], next: { kind: 'merge' } })
  })

  it('puts the push first, as it runs the checks again', () => {
    const standing = standingOf(
      change({ localHead: 'def456', unpushed: 1, checks: checks({ outcome: 'failed', passed: 1, failed: 1, failing: ['test'] }) }),
    )
    expect(standing.blockers.map((one) => one.kind)).toEqual(['unpushed', 'failed'])
    expect(standing.next).toEqual({ kind: 'push', commits: 1 })
    expect(isBlocked(standing)).toBe(true)
  })
})
