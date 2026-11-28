import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { BoardView, runningIn } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Running is in the order the board has it, the oldest first, until the
 * person picks Status from the menu on its head: then cards stand by what
 * each says, those that say the same together, at work first, each where it
 * stood among them. The pick is kept across launches.
 */

const NOW = '2026-10-01T10:00:00.000Z'

const task = (taskId: string, overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  taskId,
  threadId: `th-${taskId}`,
  title: `Task ${taskId}`,
  slug: taskId,
  phase: 'running',
  step: 'implement',
  startedAt: '2026-10-01T09:00:00.000Z',
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

/** Oldest first: one paused for a usage limit, one at work, one waiting on its checks, another at work. */
const board = (): BoardSnapshot => ({
  cursor: 1,
  tasks: [
    task('paused', { continues: false, waits: { agentId: 'claude-code', until: '2026-10-01T11:00:00.000Z' } }),
    task('first'),
    task('outside', {
      externalWait: {
        reason: 'Waiting for the deploy',
        deadline: '2026-10-01T12:00:00.000Z',
        lastCheck: null,
        nextCheck: '2026-10-01T10:05:00.000Z',
        error: null,
      },
    }),
    task('second'),
  ],
  calls: [],
  settledTotal: 0,
})

const titles = () =>
  within(screen.getByRole('region', { name: 'Running' }))
    .getAllByRole('article')
    .map((article) => within(article).getAllByRole('button')[0]!.textContent)

describe('Running’s order', () => {
  it('puts what is at work first, then what waits outside, then what is paused, each keeping its place', () => {
    const { running } = lanesOf(board())
    expect(runningIn(running, 'oldest').map((one) => one.taskId)).toEqual(['paused', 'first', 'outside', 'second'])
    expect(runningIn(running, 'status').map((one) => one.taskId)).toEqual(['first', 'second', 'outside', 'paused'])
  })

  it('groups a lane of cards that are all running by what each says, at work, then waiting, then the person’s, stopped last', () => {
    const wait = {
      reason: 'Waiting for the deploy',
      deadline: '2026-10-01T12:00:00.000Z',
      lastCheck: null,
      nextCheck: '2026-10-01T10:05:00.000Z',
      error: null,
    }
    const mix = [
      task('stopped', { phase: 'stopped' }),
      task('queue', { step: 'merge_queue' }),
      task('review-a', { step: 'review' }),
      task('unsent', { conflictUnsent: 'Its lead is signed out.' }),
      task('checks-a', { step: 'checks_running' }),
      task('implement-a'),
      task('queued', { queued: { busy: 2, atOnce: 2 } }),
      task('merging', { step: 'merging' }),
      task('settle', { step: 'settle' }),
      task('on-merge', { step: 'publish', shipAt: 'merge' }),
      task('outside', { externalWait: wait }),
      task('conflict', { step: 'conflict' }),
      task('working', { kind: 'plain', step: null }),
      task('implement-b'),
      task('checks-b', { step: 'checks_running' }),
      task('setting-up', { settingUp: 'install' }),
      task('review-b', { step: 'review' }),
    ]
    expect(runningIn(mix, 'status').map((one) => one.taskId)).toEqual([
      'setting-up',
      'implement-a',
      'implement-b',
      'working',
      'review-a',
      'settle',
      'review-b',
      'conflict',
      'merging',
      'checks-a',
      'checks-b',
      'on-merge',
      'queue',
      'queued',
      'outside',
      'unsent',
      'stopped',
    ])
    expect(runningIn(mix, 'oldest')).toBe(mix)
  })

  it('sorts from the menu on Running’s head at once, and keeps the pick for the next board', async () => {
    const mixed: BoardSnapshot = {
      ...board(),
      tasks: [
        task('checks-a', { step: 'checks_running' }),
        task('review-a', { step: 'review' }),
        task('implement-a'),
        task('checks-b', { step: 'checks_running' }),
        task('review-b', { step: 'review' }),
        task('implement-b'),
      ],
    }
    const view = () => <BoardView lanes={lanesOf(mixed)} agents={agents} now={NOW} onOpen={vi.fn()} />
    const shown = (...ids: string[]) => ids.map((id) => expect.stringContaining(`Task ${id}`))
    const byStatus = shown('implement-a', 'implement-b', 'review-a', 'review-b', 'checks-a', 'checks-b')
    const { unmount } = withServices(view(), fakeClient().client)
    expect(titles()).toEqual(shown('checks-a', 'review-a', 'implement-a', 'checks-b', 'review-b', 'implement-b'))
    await userEvent.click(screen.getByRole('button', { name: 'Sort Running' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    expect(titles()).toEqual(byStatus)
    unmount()
    withServices(view(), fakeClient().client)
    expect(titles()).toEqual(byStatus)
  })
})
