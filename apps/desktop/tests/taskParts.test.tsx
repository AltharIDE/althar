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
