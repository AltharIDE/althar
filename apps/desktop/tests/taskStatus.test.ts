import { describe, expect, it } from 'vitest'

import type { BoardTask, ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { readyCardOf, runningCardOf, stoppedCardOf } from '../src/renderer/features/board/BoardView'
import { elapsedOf, statusOf, tookOf } from '../src/renderer/features/task/TaskView'
import { taskStatusOf } from '../src/renderer/shared/taskStatus'
import { card, snapshot } from './fixtures'

/*
 * Where a task stands is one reading (`taskStatusOf`): its card on the board
 * and its header in its view say the same of the same card, whatever holds
 * it, as the runtime's card is the same for both.
 */

const NOW = '2026-10-01T10:00:00.000Z'

/** One task's card, as the board has it and as its view's head has it. */
const both = (overrides: Partial<BoardTask>) => {
  const work: BoardTask = {
    ...card(),
    phase: 'running',
    step: null,
    state: 'open',
    createdAt: '2026-10-01T09:00:00.000Z',
    settledAt: null,
    changed: null,
    here: [],
    ...overrides,
  }
  const base = snapshot()
  const view: ThreadSnapshot = {
    ...base,
    session: null,
    task: {
      ...base.task,
      phase: work.phase,
      step: work.step,
      queued: work.queued,
      waits: work.waits,
      kind: work.kind,
      state: work.state,
      ...(work.held === undefined ? {} : { held: work.held }),
      ...(work.afterMerge === undefined ? {} : { afterMerge: work.afterMerge }),
      ...(work.reconnects == null ? {} : { reconnects: work.reconnects }),
      ...(work.externalWait === undefined ? {} : { externalWait: work.externalWait }),
      ...(work.stopped == null ? {} : { stopped: work.stopped }),
    },
  }
  return { work, view }
}

/** The card's status, as the board lays it: under way and Up next, stopped, or ready. */
const onBoard = (work: BoardTask) =>
  work.phase === 'ready'
    ? readyCardOf(work).status
    : work.phase === 'stopped'
      ? stoppedCardOf(work, NOW).status
      : runningCardOf(work, NOW, () => '').status

const busy = { busy: 4, atOnce: 4 }
const waits = { agentId: 'codex', until: '2026-10-01T12:00:00.000Z' }

describe('where a task stands', () => {
  it('says what a review after the merge found, and what waits for Ship, in the task’s header', () => {
    const found = both({
      phase: 'ready',
      afterMerge: { state: 'found', findings: 2, words: 'PR #12', url: 'https://github.com/meridian/api/pull/12' },
    })
    expect(statusOf(found.view).state).toBe('Review found 2 after PR #12 merged')
    const held = both({ phase: 'ready', kind: 'plain', held: { since: NOW, commits: 3 }, branch: null })
    expect(statusOf(held.view).state).toBe('3 commits not shipped')
    expect(readyCardOf(held.work).word).toBe('Not shipped')
    expect(readyCardOf(held.work).object).toBeUndefined()
  })

  it('says why a running task is reconnecting, with or without the next retry time', () => {
    for (const next of [null, NOW]) {
      const { work, view } = both({
        reconnects: { agentId: 'codex', service: 'OpenAI', offline: true, next, failure: 'The network is down.' },
      })
      expect(statusOf(view).status).toBe(TaskStatus.Paused)
      expect(runningCardOf(work, NOW, () => 'Codex').status).toBe(TaskStatus.Paused)
      expect(statusOf(view).state).toMatch(/connection|offline|back/i)
    }
  })

  it('keeps an unasked conflict or an unchecked branch on a running card', () => {
    const unasked = both({ conflictUnsent: 'Resolve it when ready.' })
    expect(runningCardOf(unasked.work, NOW, () => '').foot).toBeDefined()
    const unchecked = both({ conflictUnchecked: 'The branch could not be read.' })
    expect(runningCardOf(unchecked.work, NOW, () => '').foot).toBeDefined()
    const ready = both({ phase: 'ready', conflictUnsent: 'Resolve it when ready.' })
    expect(readyCardOf(ready.work).foot).toBeDefined()
  })
  it('keeps an external wait running, shows its reason and next check, and hides idle clocks', () => {
    const externalWait = { reason: 'Checks on PR #402', deadline: NOW, lastCheck: NOW, nextCheck: NOW, error: null }
    const { work, view } = both({ externalWait, step: 'implement' })
    const card = runningCardOf(work, NOW, () => '')
    expect(card.status).toBe(TaskStatus.Running)
    expect(card.word).toBe('Waiting')
    expect(card.why).toContain('Checks on PR #402')
    expect(card.at).toBeUndefined()
    expect(statusOf(view).state).toBe('Waiting')
    expect(statusOf(view).why).toContain('next check')
    expect(elapsedOf(view, NOW)).toBeNull()
    expect(tookOf(view, NOW)).toBeNull()
  })
  for (const [what, overrides, status] of [
    ['under way, between agents, no session yet', { phase: 'running' }, TaskStatus.Running],
    ['on a step', { phase: 'running', step: 'implement' }, TaskStatus.Running],
    ['waiting its turn for an agent', { phase: 'running', step: 'implement', queued: busy }, TaskStatus.Queued],
    ['held for a usage limit', { phase: 'running', step: 'implement', waits }, TaskStatus.Paused],
    ['held for a usage limit while every agent is busy', { phase: 'running', step: 'implement', waits, queued: busy }, TaskStatus.Paused],
    ['its plan counting down', { phase: 'planned' }, TaskStatus.Running],
    ['its plan held', { phase: 'held' }, TaskStatus.Running],
    ['stopped', { phase: 'stopped', stopped: { by: 'interrupted', at: NOW } }, TaskStatus.Stopped],
    ['ready', { phase: 'ready' }, TaskStatus.Yours],
  ] as const)
    it(`is the same on its card and in its header: ${what}`, () => {
      const { work, view } = both(overrides as Partial<BoardTask>)
      expect(onBoard(work)).toBe(status)
      expect(statusOf(view).status).toBe(status)
      expect(taskStatusOf(work)).toBe(status)
    })

  it('is the person’s while a call of theirs stands, whatever else holds it', () => {
    expect(taskStatusOf({ phase: 'waiting', queued: busy, waits })).toBe(TaskStatus.Yours)
    expect(taskStatusOf({ phase: 'running', queued: null, waits: null, calls: 1 })).toBe(TaskStatus.Yours)
  })

  it('is under way while its pull request is in the merge queue, or its folder comes back; done once settled', () => {
    expect(taskStatusOf({ phase: 'ready', queued: null, waits: null, inMergeQueue: true })).toBe(TaskStatus.Running)
    expect(taskStatusOf({ phase: 'settled', queued: null, waits: null, folder: 'returning' })).toBe(TaskStatus.Running)
    expect(taskStatusOf({ phase: 'settled', queued: null, waits: null })).toBe(TaskStatus.Done)
    expect(taskStatusOf({ phase: 'kept', queued: null, waits: null })).toBe(TaskStatus.Paused)
  })
})
