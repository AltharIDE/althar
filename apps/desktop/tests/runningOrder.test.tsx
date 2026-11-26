import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf, runningIn } from '../src/renderer/features/board/lanes'
import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Running is in the order the board has it, the oldest first, until the
 * person picks Status from the menu on its head: then what an agent is at
 * work on comes first, and what stands still after it, each where it stood
 * among those that stand as it does. The pick is kept across launches.
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

  it('sorts from the menu on Running’s head at once, and keeps the pick for the next board', async () => {
    const view = () => <BoardView lanes={lanesOf(board())} agents={agents} now={NOW} onOpen={vi.fn()} />
    const { unmount } = withServices(view(), fakeClient().client)
    expect(titles()[0]).toContain('Task paused')
    await userEvent.click(screen.getByRole('button', { name: 'Sort Running' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    expect(titles()).toEqual(['first', 'second', 'outside', 'paused'].map((id) => expect.stringContaining(`Task ${id}`)))
    unmount()
    withServices(view(), fakeClient().client)
    expect(titles().at(-1)).toContain('Task paused')
  })
})
