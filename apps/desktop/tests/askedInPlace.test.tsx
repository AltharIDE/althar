import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { makeRouter } from '../src/renderer/router'
import { fakeClient, fakeHost, home } from './fixtures'
import { servicesFor } from './render'

/*
 * A prompt a thread raises itself (a computer-use permission, say) brings the window forward and opens its thread, unless
 * the thread is an aside: its prompt shows where the aside already is, and the window stays where the person left it.
 */

const onBoard = (one: Partial<BoardTask>) => ({ taskId: 't1', threadId: 'th1', phase: 'running', ...one }) as BoardTask

const setup = async (tasks: ReadonlyArray<BoardTask>) => {
  let open: (threadId: string, asked: boolean) => void = () => undefined
  const host = fakeHost({
    onOpen: vi.fn((listener) => {
      open = listener
      return () => undefined
    }),
  })
  const { client } = fakeClient({ getHome: vi.fn(async () => home()) })
  const services = servicesFor(client, host)
  services.cache.setQueryData(keys.board('p1'), { tasks } as unknown as BoardSnapshot)
  const router = makeRouter({ client, cache: services.cache }, createMemoryHistory({ initialEntries: ['/'] }))
  render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )
  await screen.findByRole('complementary', { name: 'Projects' })
  return { router, open: (threadId: string, asked: boolean) => act(() => open(threadId, asked)) }
}

describe('a prompt a thread raises', () => {
  it('leaves the window where it was when the thread is an aside', async () => {
    const { router, open } = await setup([onBoard({ scratch: true })])
    open('th1', true)
    expect(router.state.location.pathname).toBe('/')
  })

  it('opens the thread of a task', async () => {
    const { router, open } = await setup([onBoard({})])
    open('th1', true)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/threads/th1'))
  })

  it('still opens an aside the person clicked a notification of', async () => {
    const { router, open } = await setup([onBoard({ scratch: true })])
    open('th1', false)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/threads/th1'))
  })
})
