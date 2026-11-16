import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadSnapshot } from '@althar/contracts'

import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { useTask } from '../src/renderer/features/task/useTask'
import { changed, fakeClient, items, snapshot } from './fixtures'
import { servicesFor } from './render'

/*
 * A burst of changes to a task's thread, as an agent at work makes them:
 * what it touched is read in one call, and shows in one write, however many
 * items it was. It used to be a call and a write for each.
 */

describe('what a burst of changes touched in a thread', () => {
  it('is read in one call, and shows in one write', async () => {
    const held = [
      { ...items.says('One'), id: 'i1' },
      { ...items.says('Two'), id: 'i2' },
      { ...items.says('Kept for Althar'), id: 'k1' },
    ]
    const fake = fakeClient({ getThread: vi.fn(async () => snapshot({ items: held })) })
    vi.mocked(fake.client.getThreadItem).mockImplementation(async (_threadId, itemId) =>
      itemId === 'k1' ? null : { ...items.says(`Read again: ${itemId}`), id: itemId },
    )
    const services = servicesFor(fake.client)
    const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
    const { result } = renderHook(() => useTask('th1'), { wrapper })
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    const writes: Array<ReadonlyArray<string>> = []
    services.cache.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.queryHash === JSON.stringify(keys.thread('th1')) && event.action.type === 'success')
        writes.push(((event.query.state.data as ThreadSnapshot | undefined)?.items ?? []).map((item) => item.id))
    })
    act(() => {
      for (const id of ['i1', 'i2', 'i3', 'k1', 'i2']) fake.emit(changed('thread_item', id))
    })
    await waitFor(() => expect(result.current.snapshot?.items.map((item) => item.id)).toEqual(['i1', 'i2', 'i3']))
    expect(fake.client.getThreadItems).toHaveBeenCalledOnce()
    expect([...(vi.mocked(fake.client.getThreadItems).mock.calls[0]?.[1] ?? [])]).toEqual(['i1', 'i2', 'i3', 'k1'])
    expect(writes).toEqual([['i1', 'i2', 'i3']])
    expect(result.current.snapshot?.items.find((item) => item.id === 'i2')?.content).toMatchObject({ text: 'Read again: i2' })
  })
})
