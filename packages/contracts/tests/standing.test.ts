import { describe, expect, it } from 'vitest'

import type { ChangeSummary, ChecksSummary } from '../src/Api'
import { forShip, goingUp, isBlocked, personPushes, pushResolves, ranChecks, shipsToOpen, standingOf } from '../src/standing'

const checks = (over: Partial<ChecksSummary> = {}): ChecksSummary => ({
  outcome: 'passed',
  passed: 1,
  failed: 0,
  running: 0,
  total: 1,
  failing: [],
  list: [{ name: 'test', state: 'passed', summary: null }],
  ...over,
})

const change = (over: Partial<ChangeSummary> = {}): ChangeSummary => ({
  product: 'github',
  number: 1,
  title: 'Change',
  url: 'https://github.com/team/repository/pull/1',
  state: 'open',
  draft: false,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'team/repository',
  slug: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  checks: checks(),
  head: 'sent',
  listening: true,
  localHead: 'local',
  unpushed: 0,
  diverged: null,
  ...over,
})

describe('the shared rule for accepting a change', () => {
  it('sends committed work through Ship only when a first or next pull request is the task’s ending', () => {
    for (const end of ['draft', 'ready']) {
      expect(shipsToOpen({ end, open: false, commits: 1 })).toBe(true)
      expect(shipsToOpen({ end, open: true, commits: 1 })).toBe(false)
      expect(shipsToOpen({ end, open: false, commits: 0 })).toBe(false)
    }
    for (const end of [undefined, null, 'none', 'here']) expect(shipsToOpen({ end, open: false, commits: 1 })).toBe(false)
  })

  it.each(['moved', 'rewritten'] as const)('leaves a %s branch to the task instead of offering a push that would be refused', (kind) => {
    const seen = standingOf(change({ diverged: { kind, local: 1, onPullRequest: 2 }, unpushed: 3 }))
    expect(seen).toEqual({ blockers: [{ kind: 'parted' }], next: null })
    expect(isBlocked(seen)).toBe(true)
    expect(pushResolves(seen)).toBe(false)
  })

  it('waits for the local head before offering commits to push', () => {
    expect(standingOf(change({ localHead: null, unpushed: 3 }))).toEqual({ blockers: [], next: { kind: 'merge' } })
    expect(standingOf(change({ unpushed: 3 }))).toEqual({
      blockers: [{ kind: 'unpushed', commits: 3, held: null }],
      next: { kind: 'push', commits: 3 },
    })
  })

  it('distinguishes the person’s push, an automatic push and commits held for Ship', () => {
    const held = change({ unpushed: 2, pushing: { held: 'Someone else pushed' } })
    expect(standingOf(held)).toEqual({
      blockers: [{ kind: 'unpushed', commits: 2, held: 'Someone else pushed' }],
      next: { kind: 'push', commits: 2 },
    })
    const automatic = change({ unpushed: 2, pushing: { held: null, ship: false } })
    expect(standingOf(automatic)).toEqual({ blockers: [{ kind: 'going', commits: 2 }], next: null })
    const shipping = change({ unpushed: 2, pushing: { held: 'Held for Ship', ship: true } })
    expect(standingOf(shipping)).toEqual({ blockers: [{ kind: 'shipping', commits: 2 }], next: null })
    expect([held, automatic, shipping, change()].map((one) => [personPushes(one), goingUp(one), forShip(one)])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, false, false],
    ])
    for (const one of [held, automatic, shipping]) expect(isBlocked(standingOf(one))).toBe(false)
    const notHeld = change({ unpushed: 2, pushing: { held: null, ship: true } })
    expect(forShip(notHeld)).toBe(true)
    expect(personPushes(notHeld)).toBe(false)
    expect(goingUp(notHeld)).toBe(false)
    expect(standingOf(notHeld)).toEqual({ blockers: [{ kind: 'shipping', commits: 2 }], next: null })
    expect(isBlocked(standingOf(notHeld))).toBe(false)
  })

  it('offers the push before resolving a conflict, but keeps failing checks as a blocker', () => {
    const seen = standingOf(
      change({
        unpushed: 2,
        conflicts: true,
        target: 'main',
        checks: checks({ outcome: 'failed', passed: 0, failed: 1, failing: ['test'] }),
      }),
    )
    expect(seen).toEqual({
      blockers: [
        { kind: 'unpushed', commits: 2, held: null },
        { kind: 'conflict', target: 'main' },
        { kind: 'failed', failing: ['test'], failed: 1 },
      ],
      next: { kind: 'push', commits: 2 },
    })
    expect(pushResolves(seen)).toBe(true)
    expect(isBlocked(seen)).toBe(true)
  })

  it('asks the lead to resolve a conflict even when the host has not named its target', () => {
    for (const target of [undefined, 'main']) {
      const seen = standingOf(change({ conflicts: true, ...(target === undefined ? {} : { target }) }))
      expect(seen).toEqual({ blockers: [{ kind: 'conflict', target: target ?? null }], next: { kind: 'resolve' } })
      expect(isBlocked(seen)).toBe(true)
      expect(pushResolves(seen)).toBe(false)
    }
    expect(standingOf(change({ conflicts: null })).next).toEqual({ kind: 'merge' })
  })

  it('offers a fix for failures before considering running or cancelled checks', () => {
    const seen = standingOf(
      change({
        checks: checks({
          outcome: 'running',
          passed: 0,
          failed: 1,
          running: 1,
          total: 3,
          failing: ['test'],
          list: [
            { name: 'test', state: 'failed', summary: null },
            { name: 'lint', state: 'running', summary: null },
            { name: 'deploy', state: 'cancelled', summary: null },
          ],
        }),
      }),
    )
    expect(seen).toEqual({ blockers: [{ kind: 'failed', failing: ['test'], failed: 1 }], next: { kind: 'fix', failing: ['test'] } })
  })

  it('waits for active checks and for cancelled checks Althar has just rerun', () => {
    const list: ChecksSummary['list'] = [
      { name: 'test', state: 'passed', summary: null },
      { name: 'deploy', state: 'skipped', summary: null },
      { name: 'lint', state: 'cancelled', summary: null },
    ]
    for (const state of [checks({ running: 1, total: 3, list }), checks({ outcome: 'running', total: 3, list })]) {
      const seen = standingOf(change({ checks: state }))
      expect(seen).toEqual({ blockers: [{ kind: 'running', passed: 1, total: 2 }], next: null })
      expect(isBlocked(seen)).toBe(false)
    }
    expect(ranChecks(checks({ total: 3, list }))).toEqual({ passed: 1, total: 2 })
  })

  it('blocks accepting cancelled checks once no check is running', () => {
    const seen = standingOf(change({ checks: checks({ list: [{ name: 'deploy', state: 'cancelled', summary: null }] }) }))
    expect(seen).toEqual({ blockers: [{ kind: 'cancelled', cancelled: ['deploy'] }], next: null })
    expect(isBlocked(seen)).toBe(true)
  })

  it('accepts a clear change whether its repository has checks or none', () => {
    for (const state of [checks(), null]) {
      const seen = standingOf(change({ checks: state }))
      expect(seen).toEqual({ blockers: [], next: { kind: 'merge' } })
      expect(isBlocked(seen)).toBe(false)
    }
  })

  it('recognizes a conflict resolved by a pending push, including automatic pushes and Ship', () => {
    for (const pushing of [undefined, { held: null }, { held: 'Held for Ship', ship: true }]) {
      const seen = standingOf(change({ unpushed: 1, conflicts: true, ...(pushing === undefined ? {} : { pushing }) }))
      expect(pushResolves(seen)).toBe(true)
      expect(isBlocked(seen)).toBe(false)
    }
    expect(pushResolves(standingOf(change({ unpushed: 1 })))).toBe(false)
  })
})
