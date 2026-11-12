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

const PASSED = { outcome: 'passed', passed: 2, failed: 0, running: 0, total: 2, failing: [], list: [] } as const

const smallChange = (over: Partial<Extract<ThreadItem, { kind: 'small_change' }>['content']> = {}): ThreadItem => ({
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
    change: change({ state: 'open', head: 'abc123', checks: PASSED }),
    review: null,
    fullTask: null,
    reviewer: { agentId: 'codex', model: null },
    afterMerge: { project: 'major', task: null, holds: 'major' },
    ...over,
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
  it('merges a small change as the header does, and moves its review from its stop', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [smallChange()] })) })
    withServices(<Task />, client)
    expect(await screen.findByText('The Run menu says Strat')).toBeTruthy()
    expect(screen.getByText('1 line in RunMenu.tsx', { exact: false })).toBeTruthy()
    expect(screen.getByText('After merge')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12'))
    // No review: at once, the route ends at Merge.
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /No review/ }))
    await waitFor(() => expect(client.setReviewAfterMerge).toHaveBeenCalledWith('t1', 'none'))
    expect(screen.queryByText('After merge')).toBeNull()
    // Before it merges makes it a full task.
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Before it merges/ }))
    await waitFor(() => expect(client.makeItAFullTask).toHaveBeenCalledWith('t1'))
    expect(screen.getByText('Before merge')).toBeTruthy()
  })

  it('goes back, with a line, where moving its review fails', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [smallChange()] })),
      setReviewAfterMerge: vi.fn(async () => {
        throw new Error('The runtime is away.')
      }),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /No review/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('After merge')).toBeTruthy()
  })

  it('says what its review after the merge found, without listing it', async () => {
    const merged = smallChange({
      change: change({ state: 'merged', head: 'abc123', checks: PASSED }),
      reviewAfter: { state: 'found', findings: 2, at: when, item: 'i-verdict' },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [merged] })) })
    withServices(<Task />, client)
    expect(await screen.findByText('2 found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
    expect(screen.getByRole('button', { name: 'See findings' })).toBeTruthy()
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
