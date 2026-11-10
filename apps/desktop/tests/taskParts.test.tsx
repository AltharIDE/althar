import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's parts in its bar (ADR-097): what waits on the person acts from
 * its row, a part opens in place, and Add asks for more. Each through what
 * the window already sends.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const base = snapshot()
const parts = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^Parts, \d+/ }))
  return within(await screen.findByRole('dialog', { name: 'This task’s parts' }))
}

describe('a task’s parts', () => {
  it('merges a pull request that waits on the person from its row, at the head they saw', async () => {
    const ready = change({
      draft: false,
      head: 'abc123',
      checks: { outcome: 'passed', passed: 3, failed: 0, running: 0, total: 3, failing: [], list: [] },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...base.task, changes: [ready] } })) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith(base.task.id, 'abc123', ready.url))
  })

  it('offers to merge a stacked change through the one below it, which merges first', async () => {
    const above = change({
      draft: false,
      head: 'def456',
      short: 'PR #715',
      change: { id: 'ws_2', name: 'Lane colours', below: 'PR #714' },
      checks: { outcome: 'passed', passed: 3, failed: 0, running: 0, total: 3, failing: [], list: [] },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...base.task, changes: [above] } })) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'Merge PR #714, then PR #715' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith(base.task.id, 'def456', above.url))
  })

  it('moves a running task to Local from its folder’s row, and asks before switching a branch of the person’s own', async () => {
    const working = snapshot({ task: { ...base.task, worktree: '/tmp/w/api', branch: 'althar/add-a-retry', phase: 'ready' } })
    const { client } = fakeClient({ getThread: vi.fn(async () => working) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: /^Worktree/ }))
    await userEvent.click(await popover.findByRole('button', { name: 'Move to Local' }))
    await waitFor(() => expect(client.moveTask).toHaveBeenCalledWith({ taskId: base.task.id, to: 'checkout' }))
  })

  it('switches the person’s checkout for a move only as they saw it, or stays in the worktree', async () => {
    const seen = { branch: 'my-spike', head: 'abc1234' }
    const asking = snapshot({
      task: {
        ...base.task,
        worktree: '/tmp/w/api',
        branch: 'althar/add-a-retry',
        phase: 'ready',
        moving: { to: 'checkout', why: 'api’s checkout is on my-spike, a branch of yours: switch it?', seen },
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => asking) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'Switch it' }))
    await waitFor(() => expect(client.moveTask).toHaveBeenCalledWith({ taskId: base.task.id, to: 'checkout', consent: seen }))
    await userEvent.click(popover.getByRole('button', { name: /^Worktree/ }))
    await userEvent.click(await popover.findByRole('button', { name: 'Stay in the worktree' }))
    await waitFor(() => expect(client.dropMove).toHaveBeenCalledWith(base.task.id))
  })

  it('points a running task at another branch to work toward from its folder’s row', async () => {
    const working = snapshot({ task: { ...base.task, worktree: '/tmp/w/api', branch: 'althar/add-a-retry', phase: 'ready' } })
    const { client } = fakeClient({ getThread: vi.fn(async () => working) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: /^Worktree/ }))
    await userEvent.type(await popover.findByRole('textbox', { name: 'Another branch to work toward' }), 'release/0.8.0')
    await userEvent.click(popover.getByRole('button', { name: 'Work toward it' }))
    await waitFor(() => expect(client.workToward).toHaveBeenCalledWith(base.task.id, 'release/0.8.0'))
  })

  it('posts a review draft from its row', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [items.review({ state: 'pending' })] })) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'Post it' }))
    await waitFor(() => expect(client.postReviewDraft).toHaveBeenCalledWith('rdr_1'))
  })

  it('opens a failing check in place and asks the lead to fix it', async () => {
    const failing = change({
      checks: {
        outcome: 'failed',
        passed: 2,
        failed: 1,
        running: 0,
        total: 3,
        failing: ['e2e · macOS'],
        list: [{ name: 'e2e · macOS', state: 'failed', summary: 'run-pill.spec.ts:41' }],
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...base.task, changes: [failing] } })) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'See the check' }))
    expect(await popover.findByText(/run-pill\.spec\.ts:41/)).toBeTruthy()
    await userEvent.click(popover.getByRole('button', { name: 'Ask the lead to fix it' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: `e2e · macOS fails on ${failing.short}. Fix it.` })),
    )
  })

  it('adds a review from Add, asked of the lead in the person’s words', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    withServices(<Task />, client)
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: 'Add' }))
    await userEvent.click(popover.getByRole('button', { name: /A review/ }))
    await userEvent.type(popover.getByRole('textbox', { name: 'The pull request: its link, or its number' }), '#641{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: "Review #641 and draft what you find; don't post it." })),
    )
  })
})
