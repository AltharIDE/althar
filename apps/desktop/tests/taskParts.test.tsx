import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, fakeClient, fakeHost, items, snapshot } from './fixtures'
import type { ChangeSummary } from '@althar/contracts'
import { ServicesProvider } from '../src/renderer/data/services'
import { ApiError } from '@althar/contracts'
import { QUEUES_AFTER, useMerge } from '../src/renderer/data/merges'
import { servicesFor, withServices } from './render'

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

  it('saves a separate copy from a worker worktree and shows while it is being saved', async () => {
    let finish!: () => void
    const saveWorkerSnapshot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const working = snapshot({ task: { ...base.task, worktree: '/tmp/w/api', workerId: 'wrk_' + '1'.repeat(32) } })
    const { client } = fakeClient({ getThread: vi.fn(async () => working) })
    withServices(<Task />, client, fakeHost({ saveWorkerSnapshot }))
    const popover = await parts()
    await userEvent.click(popover.getByRole('button', { name: /^Worktree/ }))
    // Where it works is the worker, not the home's copy of its folder.
    expect(popover.getByText('Linux worker 111111')).toBeTruthy()
    await userEvent.click(await popover.findByRole('button', { name: 'Copy to this Mac…' }))
    expect(saveWorkerSnapshot).toHaveBeenCalledWith({ projectId: base.project.id, taskId: base.task.id })
    expect(popover.getByRole('button', { name: 'Copying…' })).toHaveProperty('disabled', true)
    finish()
    expect(await popover.findByRole('button', { name: 'Copy to this Mac…' })).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Stop running it' })).toBeNull()
  })

  it('stops running a pull request it runs, safely or trusted, from beside how far it trusts it', async () => {
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
      trust: 'safe' as const,
    }
    const running = snapshot({ task: { ...base.task, phase: 'running', review } })
    const { client } = fakeClient({ getThread: vi.fn(async () => running) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Stop running it' }))
    await waitFor(() => expect(client.stopRunning).toHaveBeenCalledWith(base.task.id))
    // Run safely, it still offers to trust it fully.
    expect(screen.getByRole('button', { name: 'Trust fully' })).toBeTruthy()
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

  it('lists each of several changes in its row, and ships one alone with its own Ship', async () => {
    const line = (id: string, name: string, waiting: boolean, helper: string | null = null) => ({
      id,
      name,
      branch: `althar/${id}`,
      stackedOn: null,
      waitsFor: null,
      url: null,
      waiting,
      helper,
    })
    const several = snapshot({
      task: {
        ...base.task,
        phase: 'ready',
        lines: [line('lanes', 'Lane heights', true, 'Split the migration'), line('cards', 'Card sizes', false)],
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => several) })
    withServices(<Task />, client)
    const popover = await parts()
    expect(popover.getByText('No pull request yet · Commits waiting for Ship')).toBeTruthy()
    expect(popover.getByText('Card sizes')).toBeTruthy()
    await userEvent.click(popover.getByText('Lane heights'))
    expect(popover.getByText('Split the migration')).toBeTruthy()
    await userEvent.click(await popover.findByRole('button', { name: 'Ship' }))
    await waitFor(() => expect(client.ship).toHaveBeenCalledWith(base.task.id, 'Lane heights'))
  })

  it('opens a helper’s row in place to what it said and ran, read from its own thread', async () => {
    const started = items.notice(
      {
        source: 'runtime',
        title: 'Helper · Split the migration, on the task’s change (Haiku 4.5).',
        step: { kind: 'helper', name: 'Split the migration', branch: 'on the task’s change, Haiku 4.5', toward: null, thread: 'thh1' },
      },
      null,
    )
    const lead = snapshot({ task: { ...base.task, phase: 'running' }, items: [started] })
    const helper = snapshot({
      threadId: 'thh1',
      items: [items.tool({ title: 'git grep migrate' }), items.says('Split it in two: the schema first, then the data.')],
    })
    const getThread = vi.fn(async (threadId: string) => (threadId === 'thh1' ? helper : lead))
    const { client } = fakeClient({ getThread })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'See its work' }))
    const work = await screen.findByRole('list', { name: 'Its work' })
    expect(within(work).getByText('Ran git grep migrate')).toBeTruthy()
    expect(within(work).getByText('Split it in two: the schema first, then the data.')).toBeTruthy()
    expect(getThread).toHaveBeenCalledWith('thh1', expect.objectContaining({ limit: 40 }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide its work' }))
    expect(screen.queryByRole('list', { name: 'Its work' })).toBeNull()
  })

  it('offers Keep them together on a change its lead split, and Drop it on one its git made', async () => {
    const step = (name: string, by: 'lead' | 'git') =>
      items.notice(
        {
          source: 'runtime',
          title: `New change · ${name}`,
          step: { kind: 'new_change', name, branch: `althar/${name}`, toward: null, by },
        },
        null,
      )
    const split = snapshot({ task: { ...base.task, phase: 'ready' }, items: [step('lanes', 'lead'), step('spike', 'git')] })
    const { client } = fakeClient({ getThread: vi.fn(async () => split) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Keep them together' }))
    await waitFor(() => expect(client.joinChanges).toHaveBeenCalledWith(base.task.id, 'lanes'))
    await userEvent.click(screen.getByRole('button', { name: 'Drop it' }))
    await waitFor(() => expect(client.dropChange).toHaveBeenCalledWith(base.task.id, 'spike'))
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

  describe('a merge under way, by its pull request', () => {
    /** What a part says of itself: not the pressed Merge's own words, which say Merging too, in its place. */
    const said = { ignore: '[role="status"] *, script, style' }
    const PASSED = { outcome: 'passed' as const, passed: 3, failed: 0, running: 0, total: 3, failing: [], list: [] }
    const first = change({ draft: false, head: 'aaa111', checks: PASSED, number: 714, short: 'PR #714' })
    const second = change({
      draft: false,
      head: 'bbb222',
      checks: PASSED,
      number: 715,
      short: 'PR #715',
      url: 'https://github.com/meridian/api/pull/715',
    })
    /** The task's two pull requests as the runtime reads them now: each open, unless said otherwise. */
    const reading = (read: (one: ChangeSummary) => ChangeSummary = (one) => one) =>
      vi.fn(async () => snapshot({ task: { ...base.task, changes: [read(first), read(second)] } }))
    /** A merge the runtime holds until the test answers it. */
    const held = () => {
      const answers: Array<{ resolve: () => void; reject: (failure: unknown) => void }> = []
      const merge = vi.fn(() => new Promise<void>((resolve, reject) => answers.push({ resolve, reject })))
      return { merge, answers }
    }
    it('keeps the second pull request Merging, not the first, across leaving the task and coming back, and after the call', async () => {
      const { merge, answers } = held()
      const getThread = reading()
      const { client } = fakeClient({ getThread, merge })
      const services = servicesFor(client)
      const view = (shown: boolean) => <ServicesProvider value={services}>{shown ? <Task /> : null}</ServicesProvider>
      const { rerender } = render(view(true))
      let popover = await parts()
      await userEvent.click(popover.getAllByRole('button', { name: 'Merge' })[1]!)
      await waitFor(() => expect(merge).toHaveBeenCalledWith(base.task.id, 'bbb222', second.url))
      // Away and back while the host takes it: the window, not the screen, keeps it.
      rerender(view(false))
      rerender(view(true))
      popover = await parts()
      expect(await popover.findByText('Merging', said)).toBeTruthy()
      expect(popover.getAllByRole('button', { name: 'Merge' })).toHaveLength(1)
      // Gone through, though the read after it still says open: still Merging, never merged again.
      act(() => answers[0]!.resolve())
      await waitFor(() => expect(getThread.mock.calls.length).toBeGreaterThan(2))
      expect(popover.getByText('Merging', said)).toBeTruthy()
      expect(popover.getAllByRole('button', { name: 'Merge' })).toHaveLength(1)
      expect(merge).toHaveBeenCalledOnce()
    })

    describe('going into its branch’s merge queue', () => {
      // Its branch merges through a queue, as its host said: Merge puts it there. Every read of it says open, never queued.
      const bound = change({ ...second, needs: [{ kind: 'merge_queue', state: 'met' }] })
      const one = vi.fn(async () => snapshot({ task: { ...base.task, changes: [bound] } }))
      // Merge answers its press for a moment (QUEUES_AFTER) before it shows in its queue: that moment is the clock's, not the runner's.
      beforeEach(() => void vi.useFakeTimers({ shouldAdvanceTime: true }))
      afterEach(() => void vi.useRealTimers())
      const answeredLongEnough = () => act(() => vi.advanceTimersByTimeAsync(QUEUES_AFTER))

      it('is in its queue just after Merge answers the press, before the host has answered or any read says so', async () => {
        const { merge } = held()
        const { client } = fakeClient({ getThread: one, merge })
        withServices(<Task />, client)
        const popover = await parts()
        await userEvent.click(popover.getByRole('button', { name: 'Merge' }))
        // The press, answered at once where it was made.
        expect(await popover.findByText('Merging', said)).toBeTruthy()
        // Then into the queue, the host still holding the merge and every read still saying open, not queued.
        await answeredLongEnough()
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        expect(merge).toHaveBeenCalledOnce()
        expect(popover.queryByText('Merging', said)).toBeNull()
        expect(popover.queryByRole('button', { name: 'Merge' })).toBeNull()
      })

      it('is the person’s again, saying why, where the host refuses it', async () => {
        const { merge, answers } = held()
        const { client } = fakeClient({ getThread: one, merge })
        withServices(<Task />, client)
        const popover = await parts()
        await userEvent.click(popover.getByRole('button', { name: 'Merge' }))
        await answeredLongEnough()
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        act(() => answers[0]!.reject(new ApiError({ reason: 'ConnectorFailed', message: 'The merge queue refused it.' })))
        expect(await screen.findByText('The merge queue refused it.')).toBeTruthy()
        await waitFor(() => expect(popover.queryByText('In the merge queue')).toBeNull())
        expect(popover.getByRole('button', { name: 'Merge' })).toBeTruthy()
      })

      it('is out of its queue as soon as a read says the queue took it out, once a read has said it was in', async () => {
        const { merge, answers } = held()
        let read: ChangeSummary = bound
        const getThread = vi.fn(async () => snapshot({ task: { ...base.task, changes: [read] } }))
        const { client } = fakeClient({ getThread, merge })
        const services = servicesFor(client)
        render(
          <ServicesProvider value={services}>
            <Task />
          </ServicesProvider>,
        )
        const popover = await parts()
        await userEvent.click(popover.getByRole('button', { name: 'Merge' }))
        await answeredLongEnough()
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        // The host has it in its queue, and a read says so.
        read = { ...bound, queued: true }
        act(() => answers[0]!.resolve())
        await waitFor(() => expect(getThread.mock.calls.length).toBeGreaterThan(2))
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        // Then the queue takes it out, well within the time a merge may take to land: the read says where it stands.
        read = bound
        await act(() => services.cache.invalidateQueries())
        expect(await popover.findByRole('button', { name: 'Merge' })).toBeTruthy()
        expect(popover.queryByText('In the merge queue')).toBeNull()
        expect(popover.queryByText('Merging', said)).toBeNull()
      })

      it('is out of its queue as soon as a read says so, while the host has still not answered the merge', async () => {
        const { merge, answers } = held()
        let read: ChangeSummary = bound
        const getThread = vi.fn(async () => snapshot({ task: { ...base.task, changes: [read] } }))
        const { client } = fakeClient({ getThread, merge })
        const services = servicesFor(client)
        render(
          <ServicesProvider value={services}>
            <Task />
          </ServicesProvider>,
        )
        const popover = await parts()
        await userEvent.click(popover.getByRole('button', { name: 'Merge' }))
        await answeredLongEnough()
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        // A read has it in the queue, Merge still unanswered.
        read = { ...bound, queued: true }
        await act(() => services.cache.invalidateQueries())
        // The cache tells the window on its next tick.
        await act(() => new Promise((done) => setTimeout(done, 0)))
        expect(popover.getByText('In the merge queue')).toBeTruthy()
        // Then the queue takes it out, Merge still unanswered: it is the person's to merge again, not Merging nor busy.
        read = bound
        await act(() => services.cache.invalidateQueries())
        const again = await popover.findByRole('button', { name: 'Merge' })
        expect(again.getAttribute('aria-busy')).not.toBe('true')
        expect(popover.queryByText('In the merge queue')).toBeNull()
        expect(popover.queryByText('Merging', said)).toBeNull()
        expect(answers).toHaveLength(1)
        act(() => answers[0]!.resolve())
      })
    })

    /** Outputs of the same task, pressing through the model its header reads. */
    function TaskWith({ press }: { press: (model: ReturnType<typeof useTask>) => void }) {
      const model = useTask('th1')
      return (
        <>
          <TaskView model={model} onBack={vi.fn()} />
          <button onClick={() => press(model)}>Accept both</button>
        </>
      )
    }

    it('says only the first of several is Merging while it is, the next waiting, and stops there where it goes in its queue', async () => {
      const { merge, answers } = held()
      let queued = false
      const { client } = fakeClient({
        getThread: reading((one) => (queued && one.url === first.url ? { ...one, queued: true } : one)),
        merge,
      })
      withServices(
        <TaskWith
          press={(model) =>
            void model.accept([
              { head: 'aaa111', url: first.url },
              { head: 'bbb222', url: second.url },
            ])
          }
        />,
        client,
      )
      // Once its head is read, as a press can only come after.
      await screen.findByRole('button', { name: /^Parts, \d+/ })
      await userEvent.click(screen.getByRole('button', { name: 'Accept both' }))
      await waitFor(() => expect(merge).toHaveBeenCalledOnce())
      const popover = await parts()
      // The first Merging; the second neither Merging nor to merge on its own while it waits for the first.
      expect(popover.getAllByText('Merging', said)).toHaveLength(1)
      expect(popover.queryByRole('button', { name: 'Merge' })).toBeNull()
      act(() => {
        queued = true
        answers[0]!.resolve()
      })
      // The first in its queue holds the rest: the press ends there, and the second is the person's again.
      expect(await popover.findByText('In the merge queue')).toBeTruthy()
      await waitFor(() => expect(popover.getAllByRole('button', { name: 'Merge' })).toHaveLength(1))
      expect(merge).toHaveBeenCalledOnce()
    })

    it('holds the second of Accept both across leaving the task and coming back, until the first lands', async () => {
      const { merge, answers } = held()
      let queued = false
      const { client } = fakeClient({
        getThread: reading((one) => (queued && one.url === first.url ? { ...one, queued: true } : one)),
        merge,
      })
      const services = servicesFor(client)
      const both = (model: ReturnType<typeof useTask>) =>
        void model.accept([
          { head: 'aaa111', url: first.url },
          { head: 'bbb222', url: second.url },
        ])
      const view = (shown: boolean) => <ServicesProvider value={services}>{shown ? <TaskWith press={both} /> : null}</ServicesProvider>
      const { rerender } = render(view(true))
      await screen.findByRole('button', { name: /^Parts, \d+/ })
      await userEvent.click(screen.getByRole('button', { name: 'Accept both' }))
      await waitFor(() => expect(merge).toHaveBeenCalledOnce())
      // Away and back before the first lands: the second is still held, nothing to merge on its own.
      rerender(view(false))
      rerender(view(true))
      const popover = await parts()
      expect(await popover.findByText('Merging', said)).toBeTruthy()
      expect(popover.queryByRole('button', { name: 'Merge' })).toBeNull()
      // The first goes in its queue: the press ends there, and the second is the person's again.
      act(() => {
        queued = true
        answers[0]!.resolve()
      })
      await waitFor(() => expect(popover.getAllByRole('button', { name: 'Merge' })).toHaveLength(1))
      expect(merge).toHaveBeenCalledOnce()
    })

    it('stops saying the first is Merging once its landed read finds it merged, while the second merges, though the head shown is older', async () => {
      const { merge, answers } = held()
      let landed = false
      // Only the read that asks whether it landed is fresh: the head shown stays as it was until the press ends.
      const getThread = vi.fn(async (_threadId: string, page?: { limit?: number }) =>
        snapshot({
          task: { ...base.task, changes: [landed && page?.limit === 0 ? { ...first, state: 'merged' as const } : first, second] },
        }),
      )
      const { client } = fakeClient({ getThread, merge })
      withServices(
        <TaskWith
          press={(model) =>
            void model.accept([
              { head: 'aaa111', url: first.url },
              { head: 'bbb222', url: second.url },
            ])
          }
        />,
        client,
      )
      await screen.findByRole('button', { name: /^Parts, \d+/ })
      await userEvent.click(screen.getByRole('button', { name: 'Accept both' }))
      await waitFor(() => expect(merge).toHaveBeenCalledOnce())
      act(() => {
        landed = true
        answers[0]!.resolve()
      })
      await waitFor(() => expect(merge).toHaveBeenCalledTimes(2))
      const popover = await parts()
      // Only the second, the one under way: the first's row no longer says Merging, from the read that found it merged.
      expect(popover.getAllByText('Merging', said)).toHaveLength(1)
      expect(popover.getByRole('button', { name: /PR #715/ }).textContent).toContain('Merging')
    })
  })

  describe('Outputs, as a merge pressed anywhere stands', () => {
    const QUEUED = { queued: true, canBypassQueue: true, draft: false } as const
    const PASSED = { outcome: 'passed' as const, passed: 1, failed: 0, running: 0, total: 1, failing: [], list: [] }
    const one = change({ ...QUEUED, head: 'aaa111', checks: PASSED, repository: 'meridian/api', slug: 'api' })
    const other = change({
      draft: false,
      head: 'bbb222',
      checks: PASSED,
      number: 27,
      repository: 'meridian/web',
      slug: 'web',
      url: 'https://github.com/meridian/web/pull/27',
    })
    /** The Dock's Merge without queue, pressed in the same window. */
    function Dock() {
      const merge = useMerge()
      return (
        <button onClick={() => void merge({ taskId: base.task.id, head: 'aaa111', url: one.url, bypassQueue: true })}>
          Bypass from the Dock
        </button>
      )
    }

    it.each([
      ['one pull request', [one]],
      ['several', [one, other]],
    ] as const)('says Merging, not the bypass again, while a bypass from the Dock is under way (%s)', async (_, changes) => {
      const { client } = fakeClient({
        getThread: vi.fn(async () => snapshot({ task: { ...base.task, phase: 'ready', changes: [...changes] } })),
        merge: vi.fn(() => new Promise<void>(() => {})),
      })
      const services = servicesFor(client)
      const view = (task: boolean) => (
        <ServicesProvider value={services}>
          <Dock />
          {task ? <Task /> : null}
        </ServicesProvider>
      )
      const { rerender } = render(view(false))
      await userEvent.click(screen.getByRole('button', { name: 'Bypass from the Dock' }))
      rerender(view(true))
      await waitFor(() => expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Merging'))).toBe(true))
      expect(screen.queryByRole('button', { name: 'Other ways to merge' })).toBeNull()
      expect(client.merge).toHaveBeenCalledOnce()
    })

    it('shows Ship under way at once, pressed on its card, before the runtime answers', async () => {
      const waiting = change({ draft: false, head: 'aaa111', checks: PASSED, localHead: 'def456', unpushed: 2 })
      const ship = vi.fn(() => new Promise<void>(() => {}))
      const { client } = fakeClient({
        getThread: vi.fn(async () =>
          snapshot({
            task: {
              ...base.task,
              phase: 'ready',
              changes: [waiting],
              held: { since: '2026-11-10T09:00:00.000Z', commits: 2 },
              shipRoute: { route: { review: true, far: 'merge' }, reviewable: true, bent: null },
            },
          }),
        ),
        ship,
      })
      withServices(<Task />, client)
      await userEvent.click(await screen.findByRole('button', { name: 'Ship review, then push, then ready, then merge' }))
      expect(screen.getByRole('button', { name: /^Reviewing/ }).getAttribute('aria-disabled')).toBe('true')
      expect(screen.queryByRole('button', { name: 'Ship review, then push, then ready, then merge' })).toBeNull()
      expect(ship).toHaveBeenCalledWith(base.task.id, undefined, undefined)
    })
  })
})

describe('Merge, pressed from a part’s row', () => {
  it('answers in its place, the row staying where it was while its host takes it', async () => {
    const ready = change({
      draft: false,
      head: 'abc123',
      checks: { outcome: 'passed', passed: 3, failed: 0, running: 0, total: 3, failing: [], list: [] },
    })
    const merge = vi.fn(() => new Promise<void>(() => undefined))
    const { client } = fakeClient({ merge, getThread: vi.fn(async () => snapshot({ task: { ...base.task, changes: [ready] } })) })
    withServices(<Task />, client)
    const popover = await parts()
    const pressed = popover.getByRole('button', { name: 'Merge' })
    const row = pressed.parentElement as HTMLElement
    await userEvent.click(pressed)
    // Merging, in Merge's place, in the same row: nothing moved under the pointer, nothing to press again.
    expect(row.isConnected).toBe(true)
    expect(within(row).getByRole('status').textContent).toContain('Merging')
    expect(popover.queryByRole('button', { name: 'Merge' })).toBeNull()
    // Opened, it says so in its actions too.
    await userEvent.click(within(row).getByRole('button', { name: /PR/ }))
    expect(popover.getByRole('status').textContent).toContain('Merging')
  })
})
