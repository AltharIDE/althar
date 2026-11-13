import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadItem } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { SmallChangeOf } from '../src/renderer/features/task/SmallChangeOf'
import type { SmallChangeContent } from '../src/renderer/shared/thread'
import { act } from 'react'

import { change, changed, fakeClient, items, snapshot } from './fixtures'
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

const Task = ({ onOpenTask }: { onOpenTask?: (threadId: string) => void }) => (
  <TaskView model={useTask('th1')} onBack={vi.fn()} {...(onOpenTask === undefined ? {} : { onOpenTask })} />
)

describe('a small change before the runtime knows its final route', () => {
  const show = (over: Partial<SmallChangeContent>) => {
    const item = smallChange(over)
    if (item.kind !== 'small_change') throw new Error('Expected a small change')
    const { client } = fakeClient()
    const onMerge = vi.fn()
    withServices(
      <SmallChangeOf
        card={item.content}
        named={(id, model) => ({ id: id ?? '', name: model ?? id ?? '', short: model ?? id ?? '', runtime: id ?? '', efforts: [] })}
        busy={false}
        onMerge={onMerge}
      />,
      client,
    )
    return { client, onMerge }
  }

  it.each([
    { change: null },
    { change: change({ checks: null }) },
    { change: change({ checks: { ...PASSED, outcome: 'none', total: 2 } }) },
    { change: change({ head: null, checks: PASSED }) },
    { change: change({ queued: true, checks: { ...PASSED, outcome: 'running', running: 1 } }) },
  ])('offers no merge until its head and checks are known: $change', (over) => {
    show({ ...over, steps: [] })
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })

  it('offers a known head with no checks to run, and says there is no review where none was picked', async () => {
    const { onMerge } = show({
      change: change({ head: 'head', checks: { ...PASSED, outcome: 'none', total: 0 } }),
      reviewer: null,
      steps: [{ key: 'changed', what: 'Changed a line', at: when, done: true }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(onMerge).toHaveBeenCalledWith({ head: 'head', url: 'https://github.com/meridian/api/pull/12' })
    expect(screen.queryByText('After merge')).toBeNull()
  })

  it('can put a review back even when the project defaults to none', async () => {
    const { client } = show({ afterMerge: { project: 'none', task: 'none', holds: 'none' } })
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /After it merges/ }))
    expect(client.setReviewAfterMerge).toHaveBeenCalledWith('t1', 'review')
  })

  it('holds a full task while its review is being read, even when no navigation to it was supplied', () => {
    show({ fullTask: { taskId: 'review', threadId: 'th-review', slug: 'review', title: 'Review the change' }, reviewBefore: undefined })
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'See findings' })).toBeNull()
  })
})

describe('the fast lane on a task’s screen', () => {
  it.each(['none', 'major'] as const)('only enables deferred review on an explicit choice when the project rule is %s', async (project) => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [smallChange({ afterMerge: { project, task: 'none', holds: 'none' } })] })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(client.setReviewAfterMerge).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /After it merges/ }))
    await waitFor(() => expect(client.setReviewAfterMerge).toHaveBeenCalledWith('t1', project === 'none' ? 'review' : null))
    expect(screen.getByText('After merge')).toBeTruthy()
    expect(client.makeItAFullTask).not.toHaveBeenCalled()
  })

  it.each(['unknown', 'reported none', 'not yet reported'] as const)(
    'a Small change without a reviewer respects %s checks and proposes no review',
    async (state) => {
      const checks =
        state === 'unknown' ? null : { ...PASSED, outcome: 'none' as const, passed: 0, total: state === 'reported none' ? 0 : 2 }
      const { client } = fakeClient({
        getThread: vi.fn(async () =>
          snapshot({
            items: [
              smallChange({
                reviewAfterMerge: false,
                reviewer: null,
                change: change({ state: 'open', head: 'abc123', checks }),
              }),
            ],
          }),
        ),
      })
      withServices(<Task />, client)
      await userEvent.hover(await screen.findByText('Small change', { exact: true }))
      expect(await screen.findByText(/no reviewer configured/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
      expect(screen.queryByText('After merge')).toBeNull()
      expect(client.setReviewAfterMerge).not.toHaveBeenCalled()
      if (state === 'reported none') {
        await userEvent.click(screen.getByRole('button', { name: 'Merge' }))
        await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12'))
      } else expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    },
  )

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

  it('holds Merge on a full task until its own review comes back clear, and keeps it after the merge', async () => {
    const full = { taskId: 't2', slug: 'review-the-run-menu', threadId: 'th2', title: 'Review: The Run menu says Strat' }
    let card = smallChange()
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [card] })),
      getThreadItem: vi.fn(async () => card),
    })
    const onOpenTask = vi.fn()
    withServices(<Task onOpenTask={onOpenTask} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Before it merges/ }))
    await waitFor(() => expect(client.makeItAFullTask).toHaveBeenCalledWith('t1'))
    // Chosen, before the card is read again: Merge waits.
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    const refresh = async (next: ThreadItem) => {
      card = next
      act(() => emit(changed('thread_item', 'i-small', 'th1')))
      await act(async () => {})
    }
    // Its review task reading it.
    await refresh(smallChange({ fullTask: full, reviewBefore: { state: 'running', findings: 0, at: null } }))
    expect(await screen.findByText('Reading')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    // It found something: Merge still waits, and See findings opens the review task.
    await refresh(smallChange({ fullTask: full, reviewBefore: { state: 'found', findings: 2, at: when } }))
    expect(await screen.findByText('2 found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'See findings' }))
    expect(onOpenTask).toHaveBeenCalledWith('th2')
    // Clear: Merge.
    await refresh(smallChange({ fullTask: full, reviewBefore: { state: 'clear', findings: 0, at: when } }))
    expect(await screen.findByRole('button', { name: 'Merge' })).toBeTruthy()
    // Merged: still the full task's review, not one after the merge, and its review task still opens.
    await refresh(
      smallChange({
        change: change({ state: 'merged', head: 'abc123', checks: PASSED }),
        review: full,
        fullTask: full,
        reviewBefore: { state: 'clear', findings: 0, at: when },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull())
    expect(screen.getByText('Full task')).toBeTruthy()
    expect(screen.getByText('Nothing found')).toBeTruthy()
    expect(screen.queryByText('After merge')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onOpenTask).toHaveBeenLastCalledWith('th2')
  })

  it('keeps the review task of a merged full task where only review names it', async () => {
    const full = { taskId: 't2', slug: 'review-the-run-menu', threadId: 'th2', title: 'Review: The Run menu says Strat' }
    const merged = smallChange({ change: change({ state: 'merged', head: 'abc123', checks: PASSED }), review: full, fullTask: null })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [merged] })) })
    const onOpenTask = vi.fn()
    withServices(<Task onOpenTask={onOpenTask} />, client)
    expect(await screen.findByText('Full task')).toBeTruthy()
    expect(screen.queryByText('After merge')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onOpenTask).toHaveBeenCalledWith('th2')
  })

  it('brings its review report into view from See findings, reading an earlier page for it', async () => {
    const report = {
      ...items.step({ step: 'review', verdict: 'changes_requested', summary: 'Two things in the usage card.' }),
      id: 'i-verdict',
      sequence: 2,
    }
    const card = smallChange({
      change: change({ state: 'merged', head: 'abc123', checks: PASSED }),
      reviewAfter: { state: 'found', findings: 2, at: when, item: 'i-verdict' },
    })
    const later = { ...items.you('Thanks'), sequence: 200 }
    const getThread = vi.fn(async (_id: string, page?: { before?: number }) =>
      page?.before === undefined ? snapshot({ items: [card, later], earlier: true }) : snapshot({ items: [report], earlier: false }),
    )
    const { client } = fakeClient({ getThread })
    const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    withServices(<Task />, client)
    expect(screen.queryByText('Two things in the usage card.')).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'See findings' }))
    await waitFor(() => expect(getThread).toHaveBeenCalledWith('th1', expect.objectContaining({ before: expect.any(Number) })))
    await waitFor(() => expect(document.querySelector('[data-item="i-verdict"], [data-items~="i-verdict"]')).not.toBeNull())
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    scrolled.mockRestore()
  })

  it('keeps a newly labelled Small change’s review before Ship without suggesting an extra review', async () => {
    const item = smallChange()
    if (item.kind !== 'small_change') throw new Error('not a small change')
    const before: ThreadItem = {
      ...item,
      content: {
        ...item.content,
        skips: ['no countdown', 'reviewed before it ships'],
        reviewAfterMerge: false,
        reviewBefore: { state: 'clear', findings: 0, at: when },
        steps: [...item.content.steps, { key: 'review', what: 'Reviewed before Ship', at: when, done: true }],
      },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [before] })) })
    withServices(<Task />, client)
    expect(await screen.findByText('Reviewed before Ship')).toBeTruthy()
    expect(screen.getByText('Small change')).toBeTruthy()
    expect(screen.queryByText('Full task')).toBeNull()
    expect(screen.queryByText('After merge')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
    expect(client.makeItAFullTask).not.toHaveBeenCalled()
    expect(client.setReviewAfterMerge).not.toHaveBeenCalled()
  })

  for (const what of ['Review skipped', 'Review failed', 'Review waiting', 'Review needs attention', 'Review stopped']) {
    it(`shows a before-Ship ${what.toLowerCase()} outcome truthfully in the redesigned card`, async () => {
      const item = smallChange()
      if (item.kind !== 'small_change') throw new Error('not a small change')
      const waiting = what === 'Review waiting' || what === 'Review needs attention'
      const before = smallChange({
        reviewAfterMerge: false,
        ...(waiting ? {} : { reviewBefore: { state: 'stopped', findings: 0, at: when } }),
        steps: [...item.content.steps, { key: 'review', what, at: waiting ? null : when, done: false }],
      })
      const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [before] })) })
      withServices(<Task />, client)
      expect(await screen.findByText(what)).toBeTruthy()
      expect(screen.queryByText('Reading')).toBeNull()
      expect(screen.queryByText('Nothing found')).toBeNull()
      expect(screen.queryByText('After merge')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
      if (what === 'Review skipped') expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
      else expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    })
  }

  it('keeps actual after-merge debt visible on a Small change configured for before-Ship review', async () => {
    const card = smallChange({
      reviewAfterMerge: false,
      change: change({ state: 'merged', head: 'abc123', checks: PASSED }),
      reviewAfter: { state: 'clear', findings: 0, at: when, item: 'i-verdict' },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [card] })) })
    withServices(<Task />, client)
    expect(await screen.findByText('Nothing found')).toBeTruthy()
    expect(screen.queryByText('Reviewed before Ship')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
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
