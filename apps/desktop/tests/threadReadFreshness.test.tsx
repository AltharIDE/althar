import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CoordinatorSnapshot, ThreadSnapshot } from '@althar/contracts'

import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { useProject } from '../src/renderer/features/project/useProject'
import { useTask } from '../src/renderer/features/task/useTask'
import { card, changed, coordinatorSnapshot, fakeClient, items, snapshot } from './fixtures'
import { servicesFor } from './render'

function CoordinatorRead() {
  return <span>{useProject('p1').coordinator === null ? 'Loading' : 'Loaded'}</span>
}

function TaskRead() {
  return <span>{useTask('th1').snapshot === null ? 'Loading' : 'Loaded'}</span>
}

describe('thread reads that outlive a cache update', () => {
  for (const kind of ['coordinator', 'task'] as const) {
    it(`rereads newly queued input before a ${kind} head arrives, even before the next render`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        let finishHead = () => {}
        const ready = new Promise<void>((resolve) => {
          finishHead = resolve
        })
        const coordinator = coordinatorSnapshot({ items: [] })
        const task = snapshot({ items: [] })
        const queued = items.you('Arrived while reading', { state: 'queued', interrupting: false })
        const fake = fakeClient({
          getCoordinator: vi.fn(async (_projectId, options) => {
            if (options?.limit === 0) await ready
            return coordinator
          }),
          getThread: vi.fn(async (_threadId, options) => {
            if (options?.limit === 0) await ready
            return task
          }),
          getThreadItem: vi.fn(async () => ({ ...queued, input: { state: 'delivered' as const, interrupting: false } })),
        })
        const services = servicesFor(fake.client)
        render(<ServicesProvider value={services}>{kind === 'coordinator' ? <CoordinatorRead /> : <TaskRead />}</ServicesProvider>)
        await screen.findByText('Loaded')
        const threadId = kind === 'coordinator' ? coordinator.threadId : task.threadId
        act(() => fake.emit(changed('provider_session', 's1', threadId)))
        await vi.advanceTimersByTimeAsync(50)
        const headRead = kind === 'coordinator' ? fake.client.getCoordinator : fake.client.getThread
        await waitFor(() => expect(headRead).toHaveBeenLastCalledWith(kind === 'coordinator' ? 'p1' : 'th1', { limit: 0 }))
        // Another read lands in the cache while this head is in flight. Its promise resolves before React renders it.
        act(() => {
          if (kind === 'coordinator')
            services.cache.setQueryData<CoordinatorSnapshot>(keys.coordinator('p1'), { ...coordinator, items: [queued] })
          else services.cache.setQueryData<ThreadSnapshot>(keys.thread('th1'), { ...task, items: [queued] })
          finishHead()
        })
        await vi.advanceTimersByTimeAsync(0)
        await waitFor(() => expect(fake.client.getThreadItem).toHaveBeenCalledWith(threadId, queued.id))
      } finally {
        vi.useRealTimers()
      }
    })
  }

  it('rereads cards loaded while a task-change batch is waiting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const first = items.card(card({ title: 'First task' }), 'c1')
      const later = items.card(card({ taskId: 't2', title: 'Loaded later' }), 'c2')
      const coordinator = coordinatorSnapshot({ items: [first] })
      const fake = fakeClient({ getCoordinator: vi.fn(async () => coordinator) })
      const services = servicesFor(fake.client)
      render(
        <ServicesProvider value={services}>
          <CoordinatorRead />
        </ServicesProvider>,
      )
      await screen.findByText('Loaded')
      act(() => {
        fake.emit(changed('run', 'r1', 'th1', 'p1'))
        // An older page finishes loading after its task moved, before the gathered change is read.
        services.cache.setQueryData<CoordinatorSnapshot>(keys.coordinator('p1'), { ...coordinator, items: [first, later] })
      })
      await vi.advanceTimersByTimeAsync(50)
      await waitFor(() =>
        expect(
          vi
            .mocked(fake.client.getThreadItem)
            .mock.calls.map(([, id]) => id)
            .toSorted(),
        ).toEqual(['c1', 'c2']),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
