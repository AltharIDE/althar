import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { reads } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { asidesText, useAsideClears } from '../src/renderer/features/project/Asides'
import { fakeClient } from './fixtures'
import { servicesFor } from './render'

/*
 * Clearing an aside is instant (docs/decisions/foundations.md, "The UI is instant"): its
 * pill goes in the frame the × is pressed, before the runtime answers; no read
 * from before the clear brings it back for a moment; and one the runtime
 * didn't clear comes back with a line.
 */

const aside = (taskId: string, more: Partial<BoardTask> = {}): BoardTask =>
  ({
    taskId,
    threadId: `th-${taskId}`,
    title: `Aside ${taskId}`,
    phase: 'ready',
    scratch: true,
    createdAt: '2026-11-12T09:00:00.000Z',
    ...more,
  }) as BoardTask

const boardOf = (tasks: ReadonlyArray<BoardTask>) => ({ projectId: 'p1', tasks }) as unknown as BoardSnapshot

const setup = (client: ReturnType<typeof fakeClient>['client']) => {
  const services = servicesFor(client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  return { services, wrapper }
}

describe('clearing an aside', () => {
  it('takes its pill away before the runtime answers, and keeps it away until a read no longer has it', async () => {
    const markTaskDone = vi.fn(() => new Promise<void>(() => undefined))
    const { wrapper } = setup(fakeClient({ markTaskDone }).client)
    const both = [aside('a1'), aside('a2')]
    const { result, rerender } = renderHook(({ scratch }) => useAsideClears('p1', scratch), { wrapper, initialProps: { scratch: both } })

    act(() => result.current.clear(['a1']))
    expect(result.current.scratch.map((one) => one.taskId)).toEqual(['a2'])
    expect(markTaskDone).toHaveBeenCalledWith('a1')

    // A read from before the clear lands: the pill stays away, rather than flickering back.
    rerender({ scratch: [aside('a1'), aside('a2')] })
    expect(result.current.scratch.map((one) => one.taskId)).toEqual(['a2'])

    // A read without it: from then on, the board says what shows.
    rerender({ scratch: [aside('a2')] })
    rerender({ scratch: [aside('a1'), aside('a2')] })
    expect(result.current.scratch.map((one) => one.taskId)).toEqual(['a1', 'a2'])
    expect(result.current.failed).toBeNull()
  })

  it('brings it back with a line when the runtime refuses', async () => {
    const { wrapper } = setup(fakeClient({ markTaskDone: vi.fn(async () => Promise.reject(new Error('gone'))) }).client)
    const { result } = renderHook(() => useAsideClears('p1', [aside('a1')]), { wrapper })

    act(() => result.current.clear(['a1']))
    expect(result.current.scratch).toEqual([])
    await waitFor(() => expect(result.current.failed).toBe(asidesText.notCleared('Aside a1')))
    expect(result.current.scratch.map((one) => one.taskId)).toEqual(['a1'])
  })

  it('brings it back with a line when the runtime answered but left it on Scratch', async () => {
    const still = [aside('a1', { phase: 'running' })]
    const { client } = fakeClient({ markTaskDone: vi.fn(async () => undefined), getBoard: vi.fn(async () => boardOf(still)) })
    const { services, wrapper } = setup(client)
    await services.cache.fetchQuery(reads(client).board('p1'))
    const { result } = renderHook(() => useAsideClears('p1', still), { wrapper })

    act(() => result.current.clear(['a1']))
    expect(result.current.scratch).toEqual([])
    await waitFor(() => expect(result.current.failed).toBe(asidesText.notCleared('Aside a1')))
    expect(result.current.scratch.map((one) => one.taskId)).toEqual(['a1'])
  })

  it('leaves it cleared when the runtime settled it', async () => {
    const { client } = fakeClient({
      markTaskDone: vi.fn(async () => undefined),
      getBoard: vi.fn(async () => boardOf([aside('a1', { phase: 'settled' })])),
    })
    const { services, wrapper } = setup(client)
    await services.cache.fetchQuery(reads(client).board('p1'))
    const { result } = renderHook(() => useAsideClears('p1', [aside('a1')]), { wrapper })

    act(() => result.current.clear(['a1']))
    await waitFor(() => expect(client.getBoard).toHaveBeenCalledTimes(2))
    expect(result.current.scratch).toEqual([])
    expect(result.current.failed).toBeNull()
  })
})
