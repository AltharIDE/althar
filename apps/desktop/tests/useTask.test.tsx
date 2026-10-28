import { act, renderHook, waitFor } from '@testing-library/react'
import { Activity, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, changed, fakeClient, items, snapshot } from './fixtures'
import { servicesFor } from './render'

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

describe('what a task hears', () => {
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
