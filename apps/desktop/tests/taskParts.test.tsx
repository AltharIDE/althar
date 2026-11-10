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

  it('runs an outside author’s pull request only as far as the person says, and the team’s at once', async () => {
    const review = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 1199,
      url: 'https://github.com/meridian/api/pull/1199',
      title: 'Send back won’t restart a dead lead session',
      author: 'ninemate',
      outside: true,
      additions: 58,
      deletions: 20,
      findings: 0,
      blocking: 0,
      verdict: null,
      posted: null,
    }
    const outside = snapshot({ task: { ...base.task, phase: 'running', review } })
    const { client } = fakeClient({ getThread: vi.fn(async () => outside) })
    const shown = withServices(<Task />, client)
    expect(await screen.findByRole('button', { name: 'Run safely' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Trust fully' }))
    await waitFor(() => expect(client.runIt).toHaveBeenCalledWith(base.task.id, 'full'))
    shown.unmount()
    // Run safely already, it offers only to trust it fully; the team's own offers Run it.
    const team = snapshot({ task: { ...base.task, phase: 'running', review: { ...review, outside: false } } })
    const second = fakeClient({ getThread: vi.fn(async () => team) })
    withServices(<Task />, second.client)
    await userEvent.click(await screen.findByRole('button', { name: 'Run it' }))
    await waitFor(() => expect(second.client.runIt).toHaveBeenCalledWith(base.task.id, undefined))
    expect(screen.queryByRole('button', { name: 'Run safely' })).toBeNull()
  })

  it('saves a task’s parts as a preset, and moves a chat off Scratch, from its menu', async () => {
    const chat = snapshot({ task: { ...base.task, phase: 'ready', scratch: true } })
    const { client } = fakeClient({ getThread: vi.fn(async () => chat) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as preset' }))
    await waitFor(() => expect(client.savePreset).toHaveBeenCalledWith({ name: base.task.title.slice(0, 40), taskId: base.task.id }))
    await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to the board' }))
    await waitFor(() => expect(client.shelveTask).toHaveBeenCalledWith(base.task.id, null))
  })

  it('shows each helper its lead started on its row, with Stop', async () => {
    const helped = snapshot({
      task: {
        ...base.task,
        phase: 'running',
        helpers: [{ id: 'hlp_1', name: 'Split the migration', change: 'Lane heights', model: 'Haiku 4.5' }],
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => helped) })
    withServices(<Task />, client)
    const popover = await parts()
    expect(popover.getByText('On Lane heights, Haiku 4.5')).toBeTruthy()
    await userEvent.click(popover.getByText('Helper · Split the migration'))
    await userEvent.click(await popover.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(client.stopHelper).toHaveBeenCalledWith(base.task.id, 'hlp_1'))
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
