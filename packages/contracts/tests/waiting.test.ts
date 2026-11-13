import { describe, expect, it } from 'vitest'

import type { ChangeSummary } from '../src/Api'
import {
  inMergeQueue,
  isAnswered,
  isAside,
  isUnshipped,
  issuesWordOf,
  kindWords,
  readyText,
  readyWordOf,
  shownChangeOf,
  shownQueued,
  standingCalls,
  waitingCount,
  waitingIn,
  waitingOn,
} from '../src/waiting'

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
  it('keeps independent calls, and keeps the oldest waiting call regardless of the order they were read', () => {
    const oldest = call('old', 't1')
    const newer = call('new', 't1', '2026-11-12T10:00:00.000Z')
    const independent = [call('coordinator', null), call('running', 't2'), call('elsewhere', 't3')]
    expect(standingCalls([card('t1', 'waiting'), card('t2', 'running')], [oldest, newer, ...independent])).toEqual([oldest, ...independent])
    const on = waitingOn([card('t1', 'waiting'), card('t2', 'running')], [newer, ...independent, oldest])
    expect(on.waiting).toEqual([{ task: card('t1', 'waiting'), call: oldest }])
    expect(on.calls).toEqual(independent)
    expect(waitingCount(on)).toBe(4)
  })

  it('counts issue changes without drafts, and gives drafts the word when both wait', () => {
    const task = card('t1', 'waiting', { issues: { drafts: 0, changes: 2 } })
    const on = waitingOn([task], [])
    expect(on.issues).toEqual([task])
    expect(on.unread).toEqual([])
    expect(issuesWordOf({ drafts: 0, changes: 2 })).toBe(kindWords.issueChanges)
    expect(issuesWordOf({ drafts: 1, changes: 2 })).toBe(kindWords.issues)
    expect(issuesWordOf(undefined)).toBe(kindWords.issueChanges)
  })

  it('shows the first open pull request and otherwise the latest, with no queue on an empty or closed set', () => {
    const merged = change({ state: 'merged', queued: true })
    const closed = change({ state: 'closed' })
    const open = change({ queued: true })
    expect(shownChangeOf([])).toBeNull()
    expect(shownChangeOf([merged, closed])).toBe(closed)
    expect(shownChangeOf([merged, open, change()])).toBe(open)
    expect(shownQueued([])).toBe(false)
    expect(shownQueued([merged])).toBe(false)
    expect(inMergeQueue([merged, open])).toBe(true)
    expect(inMergeQueue([open, change()])).toBe(false)
    expect(inMergeQueue([change()])).toBe(false)
    expect(waitingCount(waitingOn([card('t1', 'ready', { change: closed })], []))).toBe(1)
  })

  it('keeps zero counts for quiet projects, and counts calls in a project with no tasks', () => {
    expect(Object.fromEntries(waitingIn([card('t1', 'running')], [{ ...call('c1', null), projectId: 'p2' }]))).toEqual({ p1: 0, p2: 1 })
    expect(Object.fromEntries(waitingIn([card('t1', 'ready')], [], new Set(['t1'])))).toEqual({ p1: 0 })
    expect(isAside({ scratch: true, phase: 'settled' })).toBe(false)
  })
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

  it('keeps a call visible when its task has left the waiting phase or is no longer on the board', () => {
    const on = waitingOn([card('t1', 'running')], [call('a1', 't1'), call('a2', 'removed'), call('a3', null)])
    expect(on.calls.map((one) => one.id)).toEqual(['a1', 'a2', 'a3'])
    expect(waitingCount(on)).toBe(3)
  })

  it('counts a Scratch task once it settles, and names drafted issues before issue changes', () => {
    expect(isAside({ scratch: true, phase: 'settled' })).toBe(false)
    expect(isAside({ phase: 'ready' })).toBe(false)
    expect(issuesWordOf({ drafts: 1, changes: 1 })).toBe(kindWords.issues)
    expect(issuesWordOf({ drafts: 0, changes: 1 })).toBe(kindWords.issueChanges)
    expect(issuesWordOf(undefined)).toBe(kindWords.issueChanges)
  })
})

describe('a ready task, in a word', () => {
  it('distinguishes an answered review from a new draft after its last review was posted', () => {
    for (const reviewing of [null, undefined, { posted: null }, { posted: 'review-1' }, { posted: 'review-1', waiting: true }]) {
      expect(isAnswered(reviewing)).toBe(false)
      expect(readyWordOf({ kind: 'review', reviewing })).toBe(kindWords.drafted)
    }
    const reviewing = { posted: 'review-1', waiting: false }
    expect(isAnswered(reviewing)).toBe(true)
    expect(readyWordOf({ kind: 'review', reviewing })).toBe(kindWords.finished)
  })

  it('says when there is nothing to accept, or commits need a new pull request after one closed', () => {
    expect(readyWordOf({ nothingBuilt: true })).toBe(kindWords.nothingBuilt)
    expect(readyWordOf({ conflictUnsent: 'main' })).toBe(readyText.mergeConflict)
    expect(readyWordOf({})).toBe(kindWords.ready)
    for (const state of ['closed', 'merged'] as const) {
      expect(isUnshipped({ unshipped: { commits: 2 }, change: { state } })).toBe(true)
      expect(readyWordOf({ change: change({ state }), unshipped: { commits: 2 }, replied: 'now' })).toBe(kindWords.unshipped)
    }
    expect(isUnshipped({})).toBe(false)
    expect(isUnshipped({ unshipped: { commits: 2 } })).toBe(true)
    expect(isUnshipped({ unshipped: { commits: 2 }, change: { state: 'open' } })).toBe(false)
    expect(readyWordOf({ change: change(), unshipped: { commits: 2 }, replied: 'now' })).toBe(kindWords.ready)
  })

  it('says a conflict is ready once pushed only when local commits resolve it, with no other blocker', () => {
    expect(readyWordOf({ change: change({ localHead: 'def', unpushed: 2, conflicts: true }) })).toBe(readyText.readyOnPush)
    expect(readyWordOf({ change: change({ conflicts: true }) })).toBe(readyText.blocked)
    expect(readyWordOf({ afterMerge: { state: 'clear', findings: 0 }, change: change() })).toBe(kindWords.ready)
  })
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

  it('finishes a posted review only after its lead answers without another draft', () => {
    expect(isAnswered(undefined)).toBe(false)
    expect(isAnswered(null)).toBe(false)
    expect(isAnswered({ posted: null, waiting: false })).toBe(false)
    expect(isAnswered({ posted: 'review-1' })).toBe(false)
    expect(isAnswered({ posted: 'review-1', waiting: true })).toBe(false)
    const reviewing = { posted: 'review-1', waiting: false }
    expect(isAnswered(reviewing)).toBe(true)
    expect(readyWordOf({ kind: 'review', reviewing })).toBe(kindWords.finished)
  })

  it('shows waiting work after a merged pull request instead of reusing its old checks', () => {
    const previous = change({
      state: 'merged',
      checks: { outcome: 'failed', passed: 0, failed: 1, running: 0, total: 1, failing: ['test'], list: [] },
    })
    const task = { kind: 'change', change: previous, unshipped: { commits: 2 } }
    expect(isUnshipped(task)).toBe(true)
    expect(readyWordOf(task)).toBe(kindWords.unshipped)
    expect(isUnshipped({ ...task, change: change() })).toBe(false)
    expect(isUnshipped({ change: previous })).toBe(false)
    expect(readyWordOf({ kind: 'change', nothingBuilt: true })).toBe(kindWords.nothingBuilt)
    expect(readyWordOf({ kind: 'change' })).toBe(kindWords.ready)
  })

  it('keeps an open pull request’s facts ahead of an unread reply', () => {
    const open = change({ checks: { outcome: 'running', passed: 0, failed: 0, running: 1, total: 1, failing: [], list: [] } })
    expect(readyWordOf({ kind: 'change', change: open, replied: '2026-11-12T09:00:00.000Z' })).toBe(readyText.checksRunning)
    expect(readyWordOf({ kind: 'change', conflictUnsent: 'The merge is held.' })).toBe(readyText.mergeConflict)
    expect(readyWordOf({ kind: 'change', change: change({ conflicts: true, localHead: 'new', unpushed: 1 }) })).toBe(readyText.readyOnPush)
  })

  it('chooses the open follow-up over settled pull requests, and queues only when every open one is queued', () => {
    const previous = change({ state: 'merged', number: 1 })
    const next = change({ number: 2, queued: true })
    const waiting = change({ number: 3 })
    expect(shownChangeOf([previous, next])).toBe(next)
    expect(shownChangeOf([previous])).toBe(previous)
    expect(shownChangeOf([])).toBeNull()
    expect(inMergeQueue([previous, next])).toBe(true)
    expect(inMergeQueue([next, waiting])).toBe(false)
    expect(inMergeQueue([previous])).toBe(false)
    expect(inMergeQueue([])).toBe(false)
    expect(shownQueued([previous, next])).toBe(true)
    expect(shownQueued([])).toBe(false)
  })
})
