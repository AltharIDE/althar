import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardTask } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { useWorkActions } from '../src/renderer/features/board/useWorkActions'
import { unmovedText } from '../src/renderer/shared/calls'
import { card, change, fakeClient } from './fixtures'
import { servicesFor } from './render'

/*
 * What the person does from a card, on the board or the home, as it shows from the press (docs/decisions/foundations.md,
 * The UI is instant): Done and Keep for later move the card at once, held until a read of it says so, whatever read
 * lands meanwhile, and come back with a line where they didn't go through; the others keep the card busy until the
 * tasks are read again after the answer, so it never offers again for a moment what it just did.
 */

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

/** An answer the test gives when it says, as a busy runtime's. */
const later = <A = void,>() => {
  let settle: { resolve: (value: A) => void; reject: (failure: unknown) => void } = { resolve: () => undefined, reject: () => undefined }
  const promise = new Promise<A>((resolve, reject) => (settle = { resolve, reject }))
  return { promise, ...settle }
}

const ready = task({ taskId: 't1', threadId: 'th1', phase: 'ready', kind: 'plain' })

/** The actions over the tasks as last read, which the test reads again by `read`; `readAgain` is the read after a press. */
const actions = (readAgain: () => Promise<ReadonlyArray<BoardTask> | undefined>) => {
  const { client } = fakeClient()
  const services = servicesFor(client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  const view = renderHook(({ tasks }: { tasks: ReadonlyArray<BoardTask> }) => useWorkActions(tasks, readAgain), {
    wrapper,
    initialProps: { tasks: [ready] as ReadonlyArray<BoardTask> },
  })
  let shown: ReadonlyArray<BoardTask> = [ready]
  const phase = () => view.result.current.over(shown).find((one) => one.taskId === 't1')?.phase
  const read = (tasks: ReadonlyArray<BoardTask>) => {
    shown = tasks
    view.rerender({ tasks })
  }
  return { client, ...view, phase, read }
}

describe('Done and Keep for later, from a card', () => {
  it.each([
    ['Done', 'markDone', 'markTaskDone', 'settled'],
    ['Keep for later', 'keep', 'keepTaskForLater', 'kept'],
  ] as const)('moves the card from %s’s press, through a read from before it, until a read says so', async (_name, press, call, to) => {
    const readAfter = later<ReadonlyArray<BoardTask>>()
    const view = actions(() => readAfter.promise)
    const kept = later()
    vi.mocked(view.client[call]).mockReturnValue(kept.promise)
    let went: Promise<boolean> = Promise.resolve(false)
    act(() => void (went = view.result.current[press]('t1')))
    expect(view.phase()).toBe(to)
    // A read from before the runtime has it: the card stays where it went.
    act(() => view.read([{ ...ready }]))
    expect(view.phase()).toBe(to)
    await act(async () => kept.resolve())
    expect(view.phase()).toBe(to)
    // Read after the answer, it is there: from then on, the read says where it is.
    await act(async () => readAfter.resolve([{ ...ready, phase: to }]))
    expect(await went).toBe(true)
    act(() => view.read([{ ...ready, phase: to }]))
    act(() => view.read([{ ...ready, phase: 'running' }]))
    expect(view.phase()).toBe('running')
    expect(view.result.current.settling.has('t1')).toBe(false)
  })

  it('brings the card back where the runtime answered but the task didn’t move, saying so on it', async () => {
    const view = actions(async () => [ready])
    let went = true
    await act(async () => {
      went = await view.result.current.markDone('t1')
    })
    expect(went).toBe(false)
    expect(view.phase()).toBe('ready')
    expect(view.result.current.failed['t1']?.message).toBe(unmovedText.other)
  })

  it('brings a card back that reads under way, saying only that it stays: under way says nothing of why', async () => {
    const view = actions(async () => [{ ...ready, phase: 'running' }])
    await act(() => view.result.current.keep('t1'))
    expect(view.result.current.failed['t1']?.message).toBe(unmovedText.other)
  })

  it('brings a kept card back where its pull request is open, saying so rather than that something opened', async () => {
    const view = actions(async () => [{ ...ready, change: change() }])
    await act(() => view.result.current.keep('t1'))
    expect(view.phase()).toBe('ready')
    expect(view.result.current.failed['t1']?.message).toBe(unmovedText.pullOpen)
  })

  it('brings a stale card back where its pull request opened before Keep, with the runtime’s refusal, its row as read', async () => {
    // Pressed on a card read before its pull request opened: the runtime refuses, and the read after says it is open.
    const view = actions(async () => [{ ...ready, change: change() }])
    view.read([ready])
    vi.mocked(view.client.keepTaskForLater).mockRejectedValue(
      new ApiError({ reason: 'TaskRefused', why: 'pull_open', message: unmovedText.pullOpen }),
    )
    let went = true
    await act(async () => {
      went = await view.result.current.keep('t1')
    })
    expect(went).toBe(false)
    expect(view.phase()).toBe('ready')
    expect(view.result.current.settling.has('t1')).toBe(false)
    expect(view.result.current.failed['t1']?.message).toBe(unmovedText.pullOpen)
  })

  it('brings the card back where the runtime refused, saying why on it', async () => {
    const view = actions(async () => [ready])
    vi.mocked(view.client.keepTaskForLater).mockRejectedValue(
      new ApiError({ reason: 'NotFound', message: 'That task isn’t there any more.' }),
    )
    await act(() => view.result.current.keep('t1'))
    expect(view.phase()).toBe('ready')
    expect(view.result.current.failed['t1']?.message).toBe('That task isn’t there any more.')
  })

  it('settles a row abandoned from Up next at once, as abandoned, and brings it back where the runtime refused', async () => {
    const view = actions(async () => undefined)
    const planned = { ...ready, phase: 'planned' as const }
    view.read([planned])
    const answer = later()
    vi.mocked(view.client.abandonTask).mockReturnValue(answer.promise)
    let went: Promise<boolean> = Promise.resolve(true)
    act(() => void (went = view.result.current.abandon('t1')))
    expect(view.client.abandonTask).toHaveBeenCalledWith('t1')
    expect(view.result.current.over([planned])[0]).toMatchObject({ phase: 'settled', state: 'abandoned' })
    await act(async () => answer.reject(new ApiError({ reason: 'NotFound', message: 'Gone.' })))
    expect(await went).toBe(false)
    expect(view.phase()).toBe('planned')
    expect(view.result.current.failed['t1']?.message).toBe('Gone.')
  })

  it('keeps each of two cards moved at once by its own press, whichever answers first', async () => {
    const other = task({ taskId: 't2', threadId: 'th2', phase: 'ready', kind: 'plain' })
    const view = actions(async () => undefined)
    view.read([ready, other])
    const first = later()
    const second = later()
    vi.mocked(view.client.markTaskDone).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    act(() => {
      void view.result.current.markDone('t1')
      void view.result.current.markDone('t2')
    })
    const phases = () => view.result.current.over([ready, other]).map((one) => one.phase)
    expect(phases()).toEqual(['settled', 'settled'])
    await act(async () => second.reject(new ApiError({ reason: 'NotFound', message: 'Gone.' })))
    expect(phases()).toEqual(['settled', 'ready'])
    await act(async () => first.resolve())
    expect(phases()).toEqual(['settled', 'ready'])
  })
})

describe('a card’s other presses', () => {
  it('keep it busy past the answer, until the tasks are read again after it', async () => {
    const readAfter = later<ReadonlyArray<BoardTask>>()
    const view = actions(() => readAfter.promise)
    let went: Promise<boolean> = Promise.resolve(false)
    act(() => void (went = view.result.current.push('t1', 'abc')))
    expect(view.result.current.pushing.has('t1')).toBe(true)
    await waitFor(() => expect(view.client.push).toHaveBeenCalledWith('t1', 'abc', undefined))
    await act(async () => {})
    expect(view.result.current.pushing.has('t1')).toBe(true)
    await act(async () => readAfter.resolve([ready]))
    expect(await went).toBe(true)
    expect(view.result.current.pushing.has('t1')).toBe(false)
  })
})
