import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardTask } from '@althar/contracts'

import {
  MERGE_QUEUE_STEP,
  MERGING_STEP,
  QUEUES_AFTER,
  asMerging,
  mergeStandingOf,
  mergesThroughQueue,
  useMerge,
  useMerging,
} from '../src/renderer/data/merges'
import { ServicesProvider } from '../src/renderer/data/services'
import { change, fakeClient } from './fixtures'
import { servicesFor } from './render'

/*
 * A merge bound for its branch's merge queue is in it from just after the
 * press, wherever it shows: the press plays through at once, and the
 * runtime's read catches up behind it (The UI is instant). Its timing, from
 * the press, is useTask's, in taskParts.test.tsx.
 */

const bound = change({ draft: false, needs: [{ kind: 'merge_queue', state: 'met' }] })
const plain = change({ draft: false })

const ready = (one: Partial<BoardTask>): BoardTask =>
  ({ threadId: `th-${one.taskId}`, phase: 'ready', step: null, createdAt: '2026-11-18T20:00:00.000Z', ...one }) as BoardTask

afterEach(() => void vi.useRealTimers())

describe('a merge going into its queue', () => {
  it('goes through its queue where its host said its branch merges through one', () => {
    expect(mergesThroughQueue(bound)).toBe(true)
    expect(mergesThroughQueue(plain)).toBe(false)
    expect(mergesThroughQueue(null)).toBe(false)
  })

  it('stands in its queue once the press is answered, though its read still says open', () => {
    expect(mergeStandingOf(bound, true)).toBe('merging')
    expect(mergeStandingOf(bound, true, false, true)).toBe('queued')
    // Not pressed, or merged meanwhile, the read says where it stands.
    expect(mergeStandingOf(bound, false, false, true)).toBeNull()
    expect(mergeStandingOf({ ...bound, state: 'merged' }, true, false, true)).toBe('merged')
    // A bypass of its queue merges it straight.
    expect(mergeStandingOf({ ...bound, queued: true }, true, true, true)).toBe('merging')
  })

  it('is at work in its merge queue on the board, not Merging, from just after the press', () => {
    const tasks = [ready({ taskId: 't1', change: bound }), ready({ taskId: 't2', change: plain })]
    const merging = new Set(['t1', 't2'])
    expect(asMerging(tasks, merging).map((one) => one.step)).toEqual([MERGING_STEP, MERGING_STEP])
    expect(asMerging(tasks, merging, new Set(['t1'])).map((one) => [one.phase, one.step])).toEqual([
      ['running', MERGE_QUEUE_STEP],
      ['running', MERGING_STEP],
    ])
    // Its press refused, it is the person's again: no longer merging, nor in a queue.
    expect(asMerging(tasks, new Set(), new Set(['t1'])).map((one) => one.phase)).toEqual(['ready', 'ready'])
  })

  it('leaves the board’s merging once a read had it in its queue and the queue took it out, Merge still unanswered', async () => {
    // Merge answers its press for a moment (QUEUES_AFTER) before it shows in its queue: that moment is the clock's, not the runner's.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const answers: Array<() => void> = []
    const { client } = fakeClient({ merge: vi.fn(() => new Promise<void>((resolve) => answers.push(resolve))) })
    const services = servicesFor(client)
    const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
    const { result, rerender } = renderHook(
      ({ read }: { read: BoardTask['change'] }) => ({ merging: useMerging([{ taskId: 't1', change: read }]), merge: useMerge() }),
      { wrapper, initialProps: { read: bound } },
    )
    act(() => void result.current.merge({ taskId: 't1', head: bound.head ?? '', url: bound.url }))
    await waitFor(() => expect(result.current.merging.merging.has('t1')).toBe(true))
    await act(() => vi.advanceTimersByTimeAsync(QUEUES_AFTER))
    expect(result.current.merging.queuing.has('t1')).toBe(true)
    // A read has it in its queue: the board's own queue step says so (queuedToMerge), not the press.
    rerender({ read: { ...bound, queued: true } })
    expect(result.current.merging.merging.has('t1')).toBe(false)
    // The queue takes it out, Merge unanswered: the person's, in Needs you, not at work merging.
    rerender({ read: bound })
    expect(result.current.merging.merging.has('t1')).toBe(false)
    expect(result.current.merging.queuing.has('t1')).toBe(false)
    expect(asMerging([ready({ taskId: 't1', change: bound })], result.current.merging.merging)[0]!.phase).toBe('ready')
    act(() => answers[0]!())
  })
})
