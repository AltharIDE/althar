import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadItem } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * The fast lane on a task's screen (README sections 6 and 7): a small
 * change's card, with Merge and Make it a full task, and Auto's line, with
 * Keep and Undo. Each presses what the runtime does.
 */

const when = '2026-11-06T14:03:00.000Z'

const smallChange = (): ThreadItem => ({
  id: 'i-small',
  sequence: 1,
  agentId: null,
  createdAt: when,
  kind: 'small_change',
  content: {
    taskId: 't1',
    threadId: 'th1',
    slug: 'the-run-menu-says-strat',
    title: 'The Run menu says Strat',
    lead: { agentId: 'claude-code', model: 'sonnet' },
    skips: ['no plan', 'reviewed after it merges'],
    steps: [
      { key: 'started', what: 'Started', at: when, done: true },
      { key: 'changed', what: 'Changed 1 line in RunMenu.tsx', at: when, done: true },
      { key: 'checks', what: 'Checks pass', at: when, done: true },
      { key: 'merged', what: 'Merged', at: null, done: false },
    ],
    change: change({ state: 'open', head: 'abc123' }),
    review: null,
    fullTask: null,
  },
})

const modelMove = (kept = false): ThreadItem => ({
  id: 'i-move',
  sequence: 2,
  agentId: null,
  createdAt: when,
  kind: 'model_move',
  content: {
    taskId: 't1',
    from: { agentId: 'claude-code', model: 'opus' },
    to: { agentId: 'claude-code', model: 'sonnet' },
    why: { percent: 92, plan: 'Claude', window: 'the week', resetsAt: '2026-11-12T09:00:00.000Z' },
    kept,
  },
})

const Task = () => <TaskView model={useTask('th1')} onBack={vi.fn()} />

describe('the fast lane on a task’s screen', () => {
  it('merges a small change as the header does, and makes it a full task', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [smallChange()] })) })
    withServices(<Task />, client)
    expect(await screen.findByText('The Run menu says Strat')).toBeTruthy()
    expect(screen.getByText(/Sonnet, no plan, reviewed after it merges/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it a full task' }))
    await waitFor(() => expect(client.makeItAFullTask).toHaveBeenCalledWith('t1'))
  })

  it('keeps the model Auto moved from, and undoes the keep', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [modelMove()] })) })
    withServices(<Task />, client)
    expect(await screen.findByText(/Moved to Claude Sonnet/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Keep Claude Opus' }))
    await waitFor(() => expect(client.keepTheModel).toHaveBeenCalledWith('i-move'))
  })

  it('puts a kept move again from Undo', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [modelMove(true)] })) })
    withServices(<Task />, client)
    expect(await screen.findByText(/Back on Claude Opus for this task/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(client.undoTheModelMove).toHaveBeenCalledWith('i-move'))
  })
})
