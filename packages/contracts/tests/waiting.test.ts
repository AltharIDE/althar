import { describe, expect, it } from 'vitest'

import type { ChangeSummary } from '../src/Api'
import { isAside, readyText, readyWordOf, shownQueued, waitingCount, waitingIn, waitingOn, kindWords } from '../src/waiting'

/*
 * The one rule for what waits on the person: the board's Needs you, its tab,
 * the home, the edge and the runtime's Dock badge all count by `waitingOn`,
 * and say a ready task by `readyWordOf`.
 */

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
    checks: { outcome: 'passed', passed: 1, failed: 0, running: 0, total: 1, failing: [], list: [] },
    ...over,
  }) as unknown as ChangeSummary

const card = (taskId: string, phase: 'waiting' | 'ready' | 'stopped' | 'running' | 'kept', over: object = {}) => ({
  taskId,
  projectId: 'p1',
  phase,
  change: null as ChangeSummary | null,
  ...over,
})

const call = (id: string, taskId: string | null, createdAt = '2026-11-12T09:00:00.000Z') => ({ id, taskId, createdAt, projectId: 'p1' })

describe('what waits on the person', () => {
  it('counts a task that waits on two calls once, by its oldest', () => {
    const on = waitingOn([card('t1', 'waiting')], [call('a2', 't1', '2026-11-12T09:05:00.000Z'), call('a1', 't1')])
    expect(on.waiting.map((one) => one.call.id)).toEqual(['a1'])
    expect(waitingCount(on)).toBe(1)
  })

  it('counts a task that waits only on issues its lead drafted, once, and not as under way', () => {
    const on = waitingOn([card('t1', 'waiting', { issues: { drafts: 2, changes: 0 } })], [])
    expect({ issues: on.issues.length, unread: on.unread.length, count: waitingCount(on) }).toEqual({ issues: 1, unread: 0, count: 1 })
    // With a call besides, it is the call's, still one thing.
    const both = waitingOn([card('t1', 'waiting', { issues: { drafts: 2, changes: 0 } })], [call('a1', 't1')])
    expect({ waiting: both.waiting.length, issues: both.issues.length, count: waitingCount(both) }).toEqual({
      waiting: 1,
      issues: 0,
      count: 1,
    })
  })

  it('leaves a waiting task whose call isn’t read yet under way, uncounted', () => {
    const on = waitingOn([card('t1', 'waiting')], [])
    expect({ unread: on.unread.length, count: waitingCount(on) }).toEqual({ unread: 1, count: 0 })
  })

  it('leaves out a ready task in its merge queue, or being merged, as the board shows it under way', () => {
    const queued = card('t1', 'ready', { change: change({ queued: true }) })
    expect(waitingCount(waitingOn([queued], []))).toBe(0)
    expect(waitingCount(waitingOn([card('t2', 'ready', { change: change() })], [], new Set(['t2'])))).toBe(0)
    // By the pull request its card shows: the first open one, queued, while another waits for it to land.
    expect(shownQueued([change({ queued: true }), change()])).toBe(true)
  })

  it('counts a stopped task, and leaves out an aside but for its call, and what is kept for later', () => {
    const tasks = [
      card('t1', 'stopped'),
      card('t2', 'ready', { scratch: true }),
      card('t3', 'waiting', { scratch: true }),
      card('t4', 'kept'),
    ]
    expect(isAside(tasks[1] ?? card('', 'ready'))).toBe(true)
    const on = waitingOn(tasks, [call('a3', 't3')])
    expect({ stopped: on.stopped.length, ready: on.ready.length, waiting: on.waiting.length, count: waitingCount(on) }).toEqual({
      stopped: 1,
      ready: 0,
      waiting: 1,
      count: 2,
    })
  })

  it('counts each project apart, as its tab does', () => {
    const counts = waitingIn([card('t1', 'ready'), { ...card('t2', 'ready'), projectId: 'p2' }], [{ ...call('a1', null), projectId: 'p2' }])
    expect(Object.fromEntries(counts)).toEqual({ p1: 1, p2: 2 })
  })
})

describe('a ready task, in a word', () => {
  it('says a change as its pull request stands, never Ready to accept where something is in its way', () => {
    expect(readyWordOf({ kind: 'change', change: change() })).toBe(kindWords.ready)
    expect(
      readyWordOf({
        kind: 'change',
        change: change({ checks: { outcome: 'failed', passed: 0, failed: 1, running: 0, total: 1, failing: ['test'], list: [] } }),
      }),
    ).toBe(readyText.blocked)
    expect(
      readyWordOf({
        kind: 'change',
        change: change({ checks: { outcome: 'running', passed: 0, failed: 0, running: 1, total: 1, failing: [], list: [] } }),
      }),
    ).toBe(readyText.checksRunning)
    expect(readyWordOf({ kind: 'change', change: change(), handedBack: 'Couldn’t resolve it.' })).toBe(readyText.mergeConflict)
  })

  it('says what else of it is the person’s first', () => {
    expect(readyWordOf({ kind: 'change', change: change({ state: 'merged' }), replied: '2026-11-12T09:00:00.000Z' })).toBe(
      kindWords.replied,
    )
    expect(readyWordOf({ kind: 'change', afterMerge: { state: 'found', findings: 2 } })).toBe('Review found 2')
    expect(readyWordOf({ kind: 'change', held: { commits: 1 } })).toBe(kindWords.notShipped)
    expect(readyWordOf({ kind: 'review', reviewing: { posted: null } })).toBe(kindWords.drafted)
    expect(readyWordOf({ kind: 'plain' })).toBe(kindWords.finished)
  })
})
