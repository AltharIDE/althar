import { describe, expect, it } from 'vitest'

import type { BoardTask, ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { readyCardOf, runningCardOf, stoppedCardOf } from '../src/renderer/features/board/BoardView'
import { statusOf } from '../src/renderer/features/task/TaskView'
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
      ...(work.reconnects == null ? {} : { reconnects: work.reconnects }),
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
