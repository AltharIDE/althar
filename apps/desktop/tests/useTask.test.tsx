import { act, renderHook, waitFor } from '@testing-library/react'
import { Activity, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, PAGE, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { doing } from '../src/renderer/features/task/actions'
import { presses, settleText, type TaskModel, useTask } from '../src/renderer/features/task/useTask'
import { change, changed, fakeClient, items, snapshot } from './fixtures'
import { servicesFor } from './render'
import { queuedOf, queueShown, readingLocallyOf } from '../src/renderer/shared/items'

/*
 * A task's view model on its own, for what its screen can't press on cue:
 * before its thread is read, while what it reads lands out of turn, and
 * where the runtime refuses with less than it usually says.
 */

const gone = () => new ApiError({ reason: 'NotFound', message: "That task isn't there any more." })

/** A read that hasn't come back, and doesn't. */
const never = <A,>() => new Promise<A>(() => {})

const hook = (client: Client) => {
  const services = servicesFor(client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  return renderHook(() => useTask('th1'), { wrapper })
}

/** Its thread read, with these changes to its task and session. */
const reading = (overrides: Partial<ThreadSnapshot> = {}) => {
  const fake = fakeClient({ getThread: vi.fn(async () => snapshot(overrides)) })
  const view = hook(fake.client)
  return { ...fake, ...view }
}

describe('a task before its thread is read', () => {
  it('sends nothing for a task it doesn’t know yet, and says why the thread can’t be read', async () => {
    const { client } = fakeClient({
      // Its thread never comes; its head, asked again after each action, isn't there.
      getThread: vi.fn((_threadId: string, page?: { readonly limit?: number }) =>
        page === undefined ? never<ThreadSnapshot>() : Promise.reject(gone()),
      ),
    })
    const { result } = hook(client)
    const model = () => result.current
    for (const action of [
      () => model().stop(),
      () => model().markReady(),
      () => model().openChange(),
      () => model().markDone(),
      () => model().keep(),
      () => model().mergeHere(),
      () => model().pushHere(),
      () => model().pushBranch(),
      () => model().accept([{ head: 'abc', url: change().url }]),
      () => model().push('abc'),
      () => model().replace('abc', 'def', change().url),
      () => model().mergeNote(change().url),
      () => model().runProject(),
      () => model().abandon(),
    ])
      await act(async () => void (await action()))
    for (const call of [
      client.stopTask,
      client.markReady,
      client.openChange,
      client.markTaskDone,
      client.keepTaskForLater,
      client.mergeHere,
      client.pushHere,
      client.pushBranch,
      client.merge,
      client.push,
      client.replacePullRequest,
      client.mergeNote,
      client.runProject,
      client.abandonTask,
    ])
      expect(call).not.toHaveBeenCalled()
    expect(model().snapshot).toBeNull()
    expect(model().error).toBe("That task isn't there any more.")
    expect(model().pending).toBe(false)
  })

  it('shows its head where that lands before its thread, without items', async () => {
    const head = snapshot({ items: [] })
    const { client } = fakeClient({
      getThread: vi.fn((_threadId: string, page?: { readonly limit?: number }) =>
        page === undefined ? never<ThreadSnapshot>() : Promise.resolve(head),
      ),
    })
    // Its files read from git, as the person looks at them.
    const files = hook(client)
    act(() => files.result.current.readFiles())
    await waitFor(() => expect(files.result.current.snapshot?.task.title).toBe('Add a retry'))
    expect(client.getThread).toHaveBeenLastCalledWith('th1', { limit: 0, fresh: true })
    expect(files.result.current.snapshot?.items).toEqual([])
    // Its head read again after an action, on a screen of its own.
    const acted = hook(client)
    await act(() => acted.result.current.interrupt())
    expect(client.interrupt).toHaveBeenCalledWith('th1')
    expect(client.getThread).toHaveBeenLastCalledWith('th1', { limit: 0 })
    expect(acted.result.current.snapshot?.task.title).toBe('Add a retry')
  })

  it('makes no thread of what it hears before the thread is read', async () => {
    let first: (value: ThreadSnapshot) => void = () => undefined
    const { client, emit } = fakeClient({
      getThread: vi.fn((_threadId: string, page?: { readonly limit?: number }) =>
        page === undefined ? new Promise<ThreadSnapshot>((resolve) => (first = resolve)) : Promise.reject(gone()),
      ),
    })
    const { result } = hook(client)
    act(() => {
      emit({ _tag: 'Launches', projectId: 'p1', launches: [] })
      emit({ _tag: 'Context', threadId: 'th1', used: 10, size: 100 })
      emit(changed('user_input', 'in1'))
    })
    expect(result.current.snapshot).toBeNull()
    // What it took back, before then, is gone from a thread there isn't yet.
    expect(await act(() => result.current.takeBack('item_queued'))).toBe(true)
    expect(result.current.snapshot).toBeNull()
    act(() => first(snapshot()))
    await waitFor(() => expect(result.current.snapshot?.task.title).toBe('Add a retry'))
  })
})

describe('opening the task’s first or next pull request', () => {
  it.each(['draft', 'ready'] as const)('runs Ship for work whose ending is %s instead of publishing around its review', async (end) => {
    const { result, client, unmount } = reading({ task: { ...snapshot().task, end, phase: 'ready', commits: 9 } })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.openChange())
    expect(client.ship).toHaveBeenCalledWith('t1')
    expect(client.openChange).not.toHaveBeenCalled()
    unmount()
  })

  it('keeps opening a draft directly for a prototype whose work ends on its branch', async () => {
    const { result, client, unmount } = reading({ task: { ...snapshot().task, end: 'none', phase: 'ready', commits: 9 } })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.openChange())
    expect(client.openChange).toHaveBeenCalledWith('t1')
    expect(client.ship).not.toHaveBeenCalled()
    unmount()
  })
})

describe('what a task hears', () => {
  it('puts an accepted message in the queue if its lead never starts, even while start is pending', async () => {
    const { client, emit, result, unmount } = reading({ session: null, accepting: 'now' })
    vi.mocked(client.startSession).mockImplementation(() => never<string>())
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    act(() => void result.current.send('No lead', { agentId: 'codex', model: null, effort: null }))
    await waitFor(() => expect(client.startSession).toHaveBeenCalled())
    const stored = { ...items.you('No lead', { state: 'queued', interrupting: false }), id: 'not-started-task', sequence: 1 }
    vi.mocked(client.getThreadItem).mockResolvedValue(stored)
    act(() => emit(changed('thread_item', stored.id, 'th1', 'p1')))
    await waitFor(() => expect(result.current.snapshot?.items.some((item) => item.id === stored.id)).toBe(true))
    await waitFor(() => {
      const head = result.current.snapshot!
      expect(head.items.find((item) => item.id === stored.id)).toMatchObject({ input: { claimed: false } })
      const shown = queueShown(head.session, result.current.pending, head.accepting, head.items)
      expect(queuedOf(head.items, shown, readingLocallyOf(head.session, head.accepting)).map((item) => item.text)).toEqual(['No lead'])
    })
    expect(result.current.pending).toBe(true)
    unmount()
  })

  it('keeps its launches where the project’s runs that changed are another project’s', async () => {
    const launch = {
      id: 'proc_1',
      taskId: 't1',
      runnableId: 'rnbl_dev',
      where: 'the task',
      command: 'bun run dev',
      url: null,
      startedAt: '2026-09-29T12:00:00.000Z',
      ended: null,
    }
    const { result, emit } = reading({ task: { ...snapshot().task, launches: [launch] } })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    act(() => emit({ _tag: 'Launches', projectId: 'p2', launches: [] }))
    expect(result.current.snapshot?.task.launches).toEqual([launch])
  })

  it('keeps no context or background of a session it doesn’t have', async () => {
    const { result, emit } = reading({ session: null })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    act(() => emit({ _tag: 'Context', threadId: 'th1', used: 10, size: 100 }))
    act(() =>
      emit({
        _tag: 'Background',
        threadId: 'th1',
        background: [{ id: 'bg1', command: 'bun run dev', url: null, startedAt: '2026-09-29T12:00:00.000Z', ended: null }],
      }),
    )
    expect(result.current.snapshot?.session).toBeNull()
  })

  it('reads its head again when its project’s rules change, which belong to no thread', async () => {
    const { result, emit, client } = reading()
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    act(() => emit(changed('policy', 'p1', null, 'p1')))
    await waitFor(() => expect(client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
    // Another project's rules aren't its own: an item of its own that changed with them is read alone.
    vi.mocked(client.getThread).mockClear()
    act(() => {
      emit(changed('policy', 'p2', null, 'p2'))
      emit(changed('thread_item', 'x1'))
    })
    await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledWith('th1', 'x1'))
    expect(client.getThread).not.toHaveBeenCalled()
  })

  it('reads what it hears once its screen shows again, though it was hidden with a read gathered (`KeptScreens`)', async () => {
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const services = servicesFor(client)
    let mode: 'visible' | 'hidden' = 'visible'
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider value={services}>
        <Activity mode={mode}>{children}</Activity>
      </ServicesProvider>
    )
    const { result, rerender } = renderHook(() => useTask('th1'), { wrapper })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    // Its task changes, and the person goes elsewhere before its head is read again.
    act(() => emit(changed('task', 't1')))
    mode = 'hidden'
    rerender()
    mode = 'visible'
    rerender()
    vi.mocked(client.getThread).mockClear()
    act(() => emit(changed('task', 't1')))
    await waitFor(() => expect(client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
  })

  it('says nothing of an item its thread keeps for Althar alone, such as what its lead could see: it draws nothing of it', async () => {
    // Its lead's session starting writes a line of the skills it could see, which the window hears of but never shows.
    const { result, emit, client } = reading({ items: [items.says('Hi.'), { ...items.says('Kept for Althar'), id: 'k1' }] })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    vi.mocked(client.getThreadItem).mockResolvedValue(null)
    act(() => emit(changed('thread_item', 'k1')))
    await waitFor(() => expect(result.current.snapshot?.items.map((item) => item.id)).not.toContain('k1'))
    expect(client.getThreadItem).toHaveBeenCalledWith('th1', 'k1')
    expect(result.current.error).toBeNull()
  })

  it('reads again what still waits its turn once a message is delivered', async () => {
    const queued = { ...items.you('Then the docs', { state: 'queued', interrupting: false }), id: 'q1' }
    const { result, emit, client } = reading({ items: [items.says('On it.'), queued] })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    act(() => emit(changed('user_input', 'in1')))
    await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledWith('th1', 'q1'))
  })
})

describe('what the person does on a task', () => {
  it('keeps that a message was dictated on the copy it shows at once, and tells the lead', async () => {
    let delivered: () => void = () => undefined
    const { result, client } = reading()
    vi.mocked(client.send).mockImplementation(() => new Promise<void>((resolve) => (delivered = resolve)))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    let sent: Promise<boolean> = Promise.resolve(false)
    act(
      () =>
        void (sent = result.current.send('Use the helper', undefined, { sent: [], pictures: [], files: [], attached: [], dictated: true })),
    )
    const copy = result.current.snapshot?.items.at(-1)
    expect(copy?.kind === 'user_message' && [copy.content.text, copy.input?.dictated]).toEqual(['Use the helper', true])
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Use the helper', disposition: 'after_current', dictated: true })
    await act(async () => {
      delivered()
      expect(await sent).toBe(true)
    })
  })

  it('has nothing to take back of a message still on its way', async () => {
    const { result, client } = reading()
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    expect(await act(() => result.current.takeBack('sending:1'))).toBe(false)
    expect(client.takeBack).not.toHaveBeenCalled()
  })

  it('starts a lead with the model chosen where the runtime no longer holds the thread, or no lead is on it', async () => {
    const { result, client } = reading({ session: { ...snapshot().session!, held: false } })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.choose({ agentId: 'codex', model: 'gpt-5.2', effort: null }))
    expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2' })
    expect(client.setModel).not.toHaveBeenCalled()
  })

  it('sends a pick back to the model the lead is on while another is held for its next turn', async () => {
    const base = snapshot().session!
    const { result, client } = reading({
      session: { ...base, model: 'opus', effort: 'high', nextLead: { agentId: base.agentId, model: 'sonnet', effort: null } },
    })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.choose({ agentId: base.agentId, model: 'opus', effort: 'high' }))
    expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'opus' })
    expect(client.setEffort).not.toHaveBeenCalled()
  })

  it('sends a pick back to the model the lead is on, made after the first was taken and before the head read lands', async () => {
    const base = snapshot().session!
    const on = { agentId: base.agentId, model: 'opus', effort: 'high' }
    let slow = false
    const releases: Array<() => void> = []
    const { client, ...view } = (() => {
      const fake = fakeClient({
        getThread: vi.fn(async () => {
          if (slow) await new Promise<void>((resolve) => releases.push(resolve))
          return snapshot({ session: { ...base, ...on } })
        }),
      })
      return { ...fake, ...hook(fake.client) }
    })()
    await waitFor(() => expect(view.result.current.snapshot).not.toBeNull())
    slow = true
    act(() => void view.result.current.choose({ ...on, model: 'sonnet' }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' }))
    // The first is taken, and the thread isn't read again yet: still as it was, on the model the pick goes back to.
    await waitFor(() => expect(releases.length).toBeGreaterThan(0))
    act(() => void view.result.current.choose(on))
    await waitFor(() => expect(client.setModel).toHaveBeenLastCalledWith({ threadId: 'th1', model: 'opus' }))
    expect(client.setModel).toHaveBeenCalledTimes(2)
    slow = false
    await act(async () => releases.forEach((release) => release()))
  })

  it('shows why Try again was refused instead of silently accepting the click', async () => {
    const { result, client } = reading()
    vi.mocked(client.tryAgain).mockRejectedValue(
      new ApiError({ reason: 'RetryRefused', message: 'There is no failed turn or lost connection to try again.' }),
    )
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.tryAgain())
    expect(result.current.error).toBe('There is no failed turn or lost connection to try again.')
  })

  it('says a pull request it closed as the task was abandoned kept its branch on its host', async () => {
    const { result, client } = reading()
    vi.mocked(client.closePullRequest).mockResolvedValue({ branch: 'GitHub protects it.' })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    let outcome: Awaited<ReturnType<typeof result.current.abandon>> | undefined
    await act(async () => {
      outcome = await result.current.abandon([{ url: change().url, name: 'PR #12', deleteBranch: true }])
    })
    expect(outcome).toEqual({ abandoned: true, open: [] })
    expect(client.closePullRequest).toHaveBeenCalledWith({ taskId: 't1', url: change().url, deleteBranch: true })
    expect(result.current.error).toBe('PR #12 is closed, but its branch stays on its host. GitHub protects it.')
  })

  it('offers to ask the lead about a merge here that conflicts, where the runtime doesn’t say in which files', async () => {
    const { result, client } = reading()
    vi.mocked(client.mergeHere).mockRejectedValue(
      new ApiError({ reason: 'CantMerge', why: 'conflicts', message: 'It conflicts with main.' }),
    )
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.mergeHere())
    expect(result.current.conflict).toBe('')
    expect(result.current.error).toBe('It conflicts with main.')
  })

  it('says which pull request refused a push for commits the branch doesn’t have: the task’s own, where none was named', async () => {
    const behind = new ApiError({ reason: 'PushRefused', why: 'behind', message: 'It has commits the branch doesn’t.' })
    const { result, client } = reading({ task: { ...snapshot().task, changes: [change()] } })
    vi.mocked(client.push).mockRejectedValue(behind)
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    await act(() => result.current.push('abc'))
    expect(client.push).toHaveBeenCalledWith('t1', 'abc', undefined)
    expect(result.current.refused).toBe(change().url)
    // Not an error: the card says so, and offers to ask the lead.
    expect(result.current.error).toBeNull()
  })

  it('shows a push refused as under way on no pull request in particular, where the task has none', async () => {
    let refuse: (failure: unknown) => void = () => undefined
    const { result, client } = reading()
    vi.mocked(client.push).mockImplementation(() => new Promise((_, reject) => (refuse = reject)))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    let pushed: Promise<void> = Promise.resolve()
    act(() => void (pushed = result.current.push('abc')))
    expect(result.current.doing).toBe('push:')
    await act(async () => {
      refuse(new ApiError({ reason: 'PushRefused', why: 'behind', message: 'Behind.' }))
      await pushed
    })
    expect(result.current.refused).toBe('')
    expect(result.current.doing).toBeNull()
  })

  it('marks the task’s own draft ready where no pull request is named', async () => {
    let ready: () => void = () => undefined
    const { result, client } = reading({ task: { ...snapshot().task, changes: [change()] } })
    vi.mocked(client.markReady).mockImplementation(() => new Promise<void>((resolve) => (ready = resolve)))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    let marked: Promise<void> = Promise.resolve()
    act(() => void (marked = result.current.markReady()))
    expect(result.current.doing).toBe('ready:')
    expect(client.markReady).toHaveBeenCalledWith('t1', undefined)
    await act(async () => {
      ready()
      await marked
    })
    expect(result.current.doing).toBeNull()
  })
})

/** A promise the test settles when it says, as a busy runtime's answer. */
const answered = <A = void,>() => {
  let settle: { resolve: (value: A) => void; reject: (failure: unknown) => void } = { resolve: () => undefined, reject: () => undefined }
  const promise = new Promise<A>((resolve, reject) => (settle = { resolve, reject }))
  return { promise, ...settle }
}

/**
 * The task as the runtime holds it, which the test changes: every read of its thread, head or item, says it as it is
 * then, read afresh each time, as the wire's are.
 */
const runtimeOf = (first: Partial<ThreadSnapshot> = {}) => {
  let held = snapshot(first)
  const fake = fakeClient({
    getThread: vi.fn(async () => structuredClone(held)),
    getThreadItem: vi.fn(async (_threadId: string, itemId: string) => held.items.find((item) => item.id === itemId) ?? null),
  })
  const view = hook(fake.client)
  return { ...fake, ...view, now: (change: Partial<ThreadSnapshot>) => (held = { ...held, ...change }), held: () => held }
}

/** The runtime's word of a change to the task: its head read again, from the runtime as it is now. */
const readAgain = async (fake: { emit: (event: ReturnType<typeof changed>) => void; client: Client }) => {
  vi.mocked(fake.client.getThread).mockClear()
  act(() => fake.emit(changed('task', 't1')))
  await waitFor(() => expect(fake.client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
  await act(async () => {})
}

describe('what a press on a task shows, before the runtime says so', () => {
  it('marks only its own press under way: nothing else is busy, and nothing is on its way to the lead', async () => {
    const task = runtimeOf({ task: { ...snapshot().task, changes: [change()] } })
    const stopping = answered()
    vi.mocked(task.client.stopTask).mockReturnValue(stopping.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    act(() => void task.result.current.stop())
    expect(task.result.current.pending).toBe(false)
    expect(task.result.current.doing).toBeNull()
    expect(task.result.current.busy.has(doing.push(change().url))).toBe(false)
    act(() => void task.result.current.abandon())
    expect(task.result.current.busy.has(presses.abandon)).toBe(true)
    expect(task.result.current.busy.has(presses.attach)).toBe(false)
    await act(async () => stopping.resolve())
    await waitFor(() => expect(task.result.current.busy.has(presses.abandon)).toBe(false))
  })

  it.each([
    ['Allow everything', (model: TaskModel) => model.setAllowEverything(true), (shown: ThreadSnapshot) => shown.task.allowEverything.task],
    [
      'Resolve conflicts',
      (model: TaskModel) => model.setResolveConflicts(true),
      (shown: ThreadSnapshot) => shown.task.resolveConflicts.task === true,
    ],
    ['Move to Scratch', (model: TaskModel) => model.shelve('scratch'), (shown: ThreadSnapshot) => shown.task.scratch === true],
    ['Part of its issue', (model: TaskModel) => model.setIssuePart(true), (shown: ThreadSnapshot) => shown.task.issuePartOf === true],
  ] as const)('shows %s from the press, through a read from before it, until a read after its answer', async (_name, press, of) => {
    const task = runtimeOf()
    const kept = answered()
    for (const call of [
      task.client.setTaskAllowEverything,
      task.client.setTaskResolveConflicts,
      task.client.shelveTask,
      task.client.setTaskIssuePart,
    ])
      vi.mocked(call).mockReturnValue(kept.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    act(() => void press(task.result.current))
    expect(of(task.result.current.snapshot!)).toBe(true)
    // The runtime's word of something else, read before the press is kept: it doesn't take it back.
    await readAgain(task)
    expect(of(task.result.current.snapshot!)).toBe(true)
    // Kept; from the read after it, what shows is the runtime's: here, changed back since by another window.
    vi.mocked(task.client.getThread).mockClear()
    await act(async () => kept.resolve())
    await waitFor(() => expect(task.client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
    await waitFor(() => expect(of(task.result.current.snapshot!)).toBe(false))
  })

  it('keeps the last of two presses of one switch made before either is kept, as each read after lands', async () => {
    const task = runtimeOf()
    const first = answered()
    const second = answered()
    vi.mocked(task.client.setTaskAllowEverything).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    act(() => void task.result.current.setAllowEverything(true))
    act(() => void task.result.current.setAllowEverything(false))
    // The first is kept, and read after: the runtime has it on, but the second is still on its way.
    task.now({ task: { ...task.held().task, allowEverything: { task: true, project: false } } })
    vi.mocked(task.client.getThread).mockClear()
    await act(async () => first.resolve())
    await waitFor(() => expect(task.client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
    await act(async () => {})
    expect(task.result.current.snapshot?.task.allowEverything.task).toBe(false)
    task.now({ task: { ...task.held().task, allowEverything: { task: false, project: false } } })
    await act(async () => second.resolve())
    await act(async () => {})
    expect(task.result.current.snapshot?.task.allowEverything.task).toBe(false)
  })

  it('keeps the last of two presses of one switch when the last is kept first: the earlier one, still waiting, shows no more', async () => {
    const task = runtimeOf()
    const first = answered()
    const second = answered()
    vi.mocked(task.client.setTaskAllowEverything).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    act(() => void task.result.current.setAllowEverything(true))
    act(() => void task.result.current.setAllowEverything(false))
    // The second is kept, and read after, while the first is still on its way: off, as the runtime says.
    task.now({ task: { ...task.held().task, allowEverything: { task: false, project: false } } })
    vi.mocked(task.client.getThread).mockClear()
    await act(async () => second.resolve())
    await waitFor(() => expect(task.client.getThread).toHaveBeenCalledWith('th1', { limit: 0 }))
    await act(async () => {})
    expect(task.result.current.snapshot?.task.allowEverything.task).toBe(false)
    // The first answers at last: what it showed doesn't come back.
    await act(async () => first.resolve())
    await act(async () => {})
    expect(task.result.current.snapshot?.task.allowEverything.task).toBe(false)
  })

  it('takes a switch back where the runtime refuses it, saying why', async () => {
    const task = runtimeOf()
    vi.mocked(task.client.setTaskAllowEverything).mockRejectedValue(
      new ApiError({ reason: 'Refused', message: 'The project never allows it.' }),
    )
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    await act(() => task.result.current.setAllowEverything(true))
    expect(task.result.current.snapshot?.task.allowEverything.task).toBe(false)
    expect(task.result.current.error).toBe('The project never allows it.')
  })

  it.each([
    ['Done', (model: TaskModel) => model.markDone(), 'settled'],
    ['Keep for later', (model: TaskModel) => model.keep(), 'kept'],
  ] as const)('settles it from %s’s press, through a read from before it', async (_name, press, phase) => {
    const task = runtimeOf({ task: { ...snapshot().task, phase: 'ready', kind: 'plain' } })
    const kept = answered()
    vi.mocked(task.client.markTaskDone).mockReturnValue(kept.promise)
    vi.mocked(task.client.keepTaskForLater).mockReturnValue(kept.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    act(() => void press(task.result.current))
    expect(task.result.current.snapshot?.task.phase).toBe(phase)
    await readAgain(task)
    expect(task.result.current.snapshot?.task.phase).toBe(phase)
    task.now({ task: { ...task.held().task, phase } })
    await act(async () => kept.resolve())
    await waitFor(() => expect(task.result.current.busy.has(phase === 'settled' ? doing.markDone : doing.keep)).toBe(false))
    expect(task.result.current.snapshot?.task.phase).toBe(phase)
    expect(task.result.current.error).toBeNull()
  })

  it('takes Done back where the runtime answered but something of it opened meanwhile, saying so', async () => {
    const task = runtimeOf({ task: { ...snapshot().task, phase: 'ready', kind: 'plain' } })
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    await act(() => task.result.current.markDone())
    expect(task.result.current.snapshot?.task.phase).toBe('ready')
    expect(task.result.current.error).toBe(settleText.stillOpen)
  })

  it('takes Done back where it failed, saying why', async () => {
    const task = runtimeOf({ task: { ...snapshot().task, phase: 'ready', kind: 'plain' } })
    vi.mocked(task.client.markTaskDone).mockRejectedValue(new ApiError({ reason: 'NotFound', message: 'That task isn’t there any more.' }))
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    await act(() => task.result.current.markDone())
    expect(task.result.current.snapshot?.task.phase).toBe('ready')
    expect(task.result.current.error).toBe('That task isn’t there any more.')
  })
})

describe('a message taken back from the queue', () => {
  const queued: ThreadItem = { ...items.you('Then the docs', { state: 'queued', interrupting: false }), id: 'q1' }
  const stateOf = (shown: ThreadSnapshot | null) => {
    const item = shown?.items.find((one) => one.id === 'q1')
    return item?.kind === 'user_message' ? item.input?.state : undefined
  }

  it('is out of the queue from the press, though a read of it from before the runtime has it lands', async () => {
    const task = runtimeOf({ items: [items.says('On it.'), queued] })
    const taken = answered()
    vi.mocked(task.client.takeBack).mockReturnValue(taken.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    let shown = false
    act(() => void (shown = task.result.current.takeBack('q1')))
    expect(shown).toBe(true)
    expect(stateOf(task.result.current.snapshot)).toBe('withdrawn')
    // What still waits is read again, as a message is delivered: the runtime hasn't taken it back yet.
    act(() => task.emit(changed('user_input', 'in1')))
    await waitFor(() => expect(task.client.getThreadItem).toHaveBeenCalledWith('th1', 'q1'))
    await act(async () => {})
    expect(stateOf(task.result.current.snapshot)).toBe('withdrawn')
    // Taken back, and read so: from then on, the read says it.
    task.now({
      items: [items.says('On it.'), { ...queued, input: { state: 'withdrawn', interrupting: false } }] as ReadonlyArray<ThreadItem>,
    })
    await act(async () => taken.resolve())
    vi.mocked(task.client.getThreadItem).mockClear()
    act(() => task.emit(changed('thread_item', 'q1')))
    await waitFor(() => expect(task.client.getThreadItem).toHaveBeenCalledWith('th1', 'q1'))
    await waitFor(() => expect(stateOf(task.result.current.snapshot)).toBe('withdrawn'))
    expect(task.result.current.error).toBeNull()
  })

  it('comes back where the lead had read it, saying why, for what it was taken back for to be put back too', async () => {
    const task = runtimeOf({ items: [items.says('On it.'), queued] })
    vi.mocked(task.client.takeBack).mockRejectedValue(new ApiError({ reason: 'AlreadyDelivered', message: 'The lead has it already.' }))
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    const refused = vi.fn()
    act(() => void task.result.current.takeBack('q1', refused))
    await waitFor(() => expect(refused).toHaveBeenCalled())
    expect(stateOf(task.result.current.snapshot)).toBe('queued')
    expect(task.result.current.error).toBe('The lead has it already.')
  })

  it('goes to the lead now, shown at once, and is never said twice where the lead had read it', async () => {
    const task = runtimeOf({ items: [items.says('On it.'), queued] })
    const taken = answered()
    vi.mocked(task.client.takeBack).mockReturnValue(taken.promise)
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    const unsent = vi.fn()
    act(() => task.result.current.sendQueuedNow('q1', 'Then the docs', undefined, unsent))
    // Out of the queue, and said again, interrupting the lead, from the press.
    expect(stateOf(task.result.current.snapshot)).toBe('withdrawn')
    const again = task.result.current.snapshot?.items.filter((item) => item.id !== 'q1' && item.kind === 'user_message')
    expect(again?.map((item) => item.kind === 'user_message' && [item.content.text, item.input?.interrupting])).toEqual([
      ['Then the docs', true],
    ])
    await act(async () => taken.reject(new ApiError({ reason: 'AlreadyDelivered', message: 'The lead has it already.' })))
    await waitFor(() => expect(task.result.current.error).toBe('The lead has it already.'))
    expect(task.client.send).not.toHaveBeenCalled()
    expect(unsent).not.toHaveBeenCalled()
    expect(task.result.current.snapshot?.items.filter((item) => item.kind === 'user_message').map((item) => item.id)).toEqual(['q1'])
  })
})

describe('a turn undone', () => {
  it('goes from the thread as its undo answers, without waiting for the thread to be read again', async () => {
    const asked: ThreadItem = { ...items.you('Try the other way'), id: 'u1', sequence: 5 }
    const task = runtimeOf({ items: [{ ...items.says('First.'), sequence: 4 }, asked, { ...items.says('Done it.'), sequence: 6 }] })
    await waitFor(() => expect(task.result.current.snapshot).not.toBeNull())
    vi.mocked(task.client.getThread).mockImplementation(never)
    vi.mocked(task.client.undoTurn).mockResolvedValue({ prompt: 'Try the other way', restored: 1, messages: [] })
    let undone: Awaited<ReturnType<TaskModel['undoTurn']>> | undefined
    await act(async () => {
      undone = await task.result.current.undoTurn('u1')
    })
    expect(undone?.prompt).toBe('Try the other way')
    expect(task.result.current.snapshot?.items.map((item) => item.sequence)).toEqual([4])
    expect(task.client.getThread).toHaveBeenLastCalledWith('th1', { limit: PAGE })
    expect(task.result.current.busy.has(presses.undo)).toBe(false)
  })
})
