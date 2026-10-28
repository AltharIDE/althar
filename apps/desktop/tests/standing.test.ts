import type { ChecksSummary } from '@althar/contracts'
import { describe, expect, it } from 'vitest'

import { doingWords, factsOf, isBlocked, labelWords, nextWords, standingOf } from '../src/renderer/shared/standing'
import { change } from './fixtures'

/*
 * What stands between a ready change and merging it, as the board's card and
 * the home's line say it: each thing in the way, most pressing first, and the
 * one next thing to do.
 */

const checks = (overrides: Partial<ChecksSummary> = {}): ChecksSummary => ({
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
  ...overrides,
})

const said = (overrides: Parameters<typeof change>[0]) => factsOf(change(overrides)).map((fact) => [fact.words, fact.tone])

describe('what stands in a change’s way', () => {
  it('puts a branch that has parted from its pull request first, and leaves the next thing to the task', () => {
    const parted = change({
      diverged: { kind: 'rewritten', local: 2, onPullRequest: 1 },
      localHead: 'def456',
      unpushed: 2,
      checks: checks(),
    })
    const standing = standingOf(parted)
    // A plain push would be refused, so the commits not on it aren't offered as one.
    expect(standing.blockers).toEqual([{ kind: 'parted' }])
    expect(standing.next).toBeNull()
    expect(factsOf(parted, standing).map((fact) => [fact.words, fact.icon, fact.tone])).toEqual([
      ['Branch and PR have parted', 'branch', 'warm'],
    ])
  })

  it('counts commits not on the pull request only once the branch’s head here is known', () => {
    expect(standingOf(change({ localHead: null, unpushed: 3, checks: checks() })).blockers).toEqual([])
    expect(said({ localHead: 'def456', unpushed: 1, checks: checks() })).toEqual([['All 2 checks passed', 'ok']])
    expect(said({ localHead: 'def456', unpushed: 4, checks: checks() })).toEqual([['All 2 checks passed', 'ok']])
    expect(standingOf(change({ localHead: 'def456', unpushed: 4, checks: checks() })).next).toEqual({ kind: 'push', commits: 4 })
  })

  it('says a conflict with the branch it merges into, by name where it is known, and asks the lead to resolve it', () => {
    const named = change({ conflicts: true, target: 'main', checks: checks() })
    expect(factsOf(named).map((fact) => fact.words)).toEqual(['Conflicts with main'])
    expect(standingOf(named).next).toEqual({ kind: 'resolve' })
    // Seen before Althar kept which branch it merges into.
    expect(said({ conflicts: true, checks: checks() })).toEqual([['Has a merge conflict', 'warm']])
    // Not worked out yet is no conflict.
    expect(standingOf(change({ conflicts: null, checks: checks() })).blockers).toEqual([])
  })

  it('names the one check that failed, or counts them when several did', () => {
    expect(said({})).toEqual([['test failed', 'danger']])
    const two = checks({ outcome: 'failed', passed: 0, failed: 2, failing: ['test', 'lint'] })
    expect(said({ checks: two })).toEqual([['2 checks failed', 'danger']])
    // Failed without a name the host gave.
    expect(said({ checks: checks({ outcome: 'failed', passed: 1, failed: 1, failing: [] }) })).toEqual([['1 check failed', 'danger']])
    expect(standingOf(change({ checks: two })).next).toEqual({ kind: 'fix', failing: ['test', 'lint'] })
  })

  it('waits on checks still running, with nothing to do but wait', () => {
    const running = change({ checks: checks({ outcome: 'running', passed: 1, running: 1, total: 3 }) })
    expect(factsOf(running).map((fact) => [fact.words, fact.icon, fact.tone])).toEqual([
      ['Checks running, 1 of 3 passed', undefined, 'live'],
    ])
    expect(standingOf(running).next).toBeNull()
  })

  it('holds on cancelled checks once the rest are done, as a host holds a merge on one', () => {
    const list = (...names: ReadonlyArray<string>) => names.map((name) => ({ name, state: 'cancelled' as const, summary: null }))
    const one = change({ checks: checks({ passed: 1, list: list('deploy') }) })
    expect(factsOf(one).map((fact) => [fact.words, fact.icon])).toEqual([['deploy cancelled', 'stop']])
    expect(standingOf(one).next).toBeNull()
    expect(said({ checks: checks({ passed: 0, list: list('deploy', 'e2e') }) })).toEqual([['2 checks cancelled', 'warm']])
  })

  it('reads what blocks first, then what to do, and offers the push first, as it runs the checks again', () => {
    const many = change({ localHead: 'def456', unpushed: 2, conflicts: true, target: 'main' })
    // The commits are the button's to say; beside a conflict, only that pushing clears it is.
    expect(factsOf(many).map((fact) => fact.words)).toEqual(['The push should resolve the conflict with main', 'test failed'])
    expect(standingOf(many).next).toEqual({ kind: 'push', commits: 2 })
    const running = change({ localHead: 'def456', unpushed: 3, checks: checks({ outcome: 'running', passed: 1, running: 1, total: 3 }) })
    expect(factsOf(running).map((fact) => fact.words)).toEqual(['Checks running, 1 of 3 passed'])
  })

  it('is blocked by a conflict or failed checks, unless pushing is what clears the conflict', () => {
    const blocked = (overrides: Parameters<typeof change>[0]) => isBlocked(standingOf(change(overrides)))
    expect(blocked({ conflicts: true, checks: checks() })).toBe(true)
    expect(blocked({})).toBe(true)
    expect(blocked({ localHead: 'def456', unpushed: 5, conflicts: true, checks: checks() })).toBe(false)
    expect(blocked({ localHead: 'def456', unpushed: 5, checks: checks() })).toBe(false)
    expect(blocked({ checks: checks({ outcome: 'running', passed: 1, running: 1, total: 3 }) })).toBe(false)
  })

  it('says how the checks went where nothing is in the way: green only where every one passed', () => {
    expect(
      factsOf(change({ checks: checks({ passed: 1, total: 1, list: [] }) })).map((fact) => [fact.words, fact.icon, fact.tone]),
    ).toEqual([['1 check passed', 'check', 'ok']])
    expect(said({ checks: checks() })).toEqual([['All 2 checks passed', 'ok']])
    // One skipped: none is in the way, though not all passed.
    expect(said({ checks: checks({ passed: 1, total: 2, list: [] }) })).toEqual([['1 of 2 checks passed', 'quiet']])
    expect(said({ checks: null })).toEqual([['No checks ran', 'quiet']])
    expect(said({ checks: checks({ passed: 0, total: 0, list: [] }) })).toEqual([['No checks ran', 'quiet']])
    expect(standingOf(change({ checks: null })).next).toEqual({ kind: 'merge' })
  })
})

describe('the next thing, in words', () => {
  it('says each next thing as its button does', () => {
    expect(nextWords({ kind: 'merge' })).toBe('Accept and merge')
    expect(nextWords({ kind: 'push', commits: 1 })).toBe('Push 1 commit')
    expect(nextWords({ kind: 'push', commits: 3 })).toBe('Push 3 commits')
    expect(nextWords({ kind: 'resolve' })).toBe('Ask the lead to resolve it')
    expect(nextWords({ kind: 'fix', failing: ['test'] })).toBe('Ask the lead to fix it')
  })

  it('says a push or merge while it is under way', () => {
    expect(doingWords({ kind: 'merge' })).toBe('Merging')
    expect(doingWords({ kind: 'push', commits: 1 })).toBe('Pushing 1 commit')
    expect(doingWords({ kind: 'push', commits: 2 })).toBe('Pushing 2 commits')
  })

  it('names the pull request the button acts on for a screen reader, and that it tries again after it failed', () => {
    expect(labelWords({ kind: 'merge' }, 'PR #12')).toBe('Accept and merge PR #12')
    expect(labelWords({ kind: 'merge' }, 'PR #12', true)).toBe('Try merging PR #12 again')
    expect(labelWords({ kind: 'push', commits: 1 }, 'PR #12')).toBe('Push 1 commit to PR #12')
    expect(labelWords({ kind: 'push', commits: 5 }, 'PR #12')).toBe('Push 5 commits to PR #12')
    expect(labelWords({ kind: 'push', commits: 1 }, 'PR #12', true)).toBe('Try pushing 1 commit to PR #12 again')
    expect(labelWords({ kind: 'push', commits: 5 }, 'PR #12', true)).toBe('Try pushing 5 commits to PR #12 again')
  })
})
