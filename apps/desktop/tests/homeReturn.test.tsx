import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HomeCall, HomeSnapshot } from '@althar/contracts'

import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { makeRouter, PENDING } from '../src/renderer/router'
import { pendingText } from '../src/renderer/shared/Pending'
import { fakeClient, home } from './fixtures'
import { servicesFor } from './render'

/*
 * Going back to the home is instant, as going back to a project's tab is:
 * the home the window holds shows at once, the same screen the person left,
 * never the outline of one being read, and what changed while they were
 * away is read behind it and shows as it lands. Only the very first time,
 * before the window has read the home at all, does a slow read show the outline.
 */

const permission: HomeCall = {
  id: 'a1',
  kind: 'permission',
  title: 'Run npm publish',
  reason: 'Deploying or publishing always asks.',
  command: 'npm publish',
  stuck: null,
  createdAt: '2026-10-07T09:10:00.000Z',
  projectId: 'p1',
  taskId: 't3',
  threadId: 'th3',
  taskTitle: 'Ship it',
  taskSlug: 'ship-it',
}

/** A read the test answers when it says, as a busy runtime's. */
const later = <T,>() => {
  let answer: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    answer = resolve
  })
  return { promise, answer: (value: T) => answer(value) }
}

const glance = () => new Promise((resolve) => setTimeout(resolve, PENDING.after + 100))

const projectsAside = () => screen.queryByRole('complementary', { name: 'Projects' })

beforeEach(() => window.localStorage.clear())

describe('going back to the home', () => {
  it('shows the home it holds at once, never the outline, and takes what changed as it lands', async () => {
    const getHome = vi.fn(async (): Promise<HomeSnapshot> => home({ calls: [permission] }))
    const { client } = fakeClient({ getHome })
    const services = servicesFor(client)
    const router = makeRouter({ client, cache: services.cache }, createMemoryHistory({ initialEntries: ['/'] }))
    render(
      <ServicesProvider value={services}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    )
    const shown = await screen.findByRole('complementary', { name: 'Projects' })
    expect(await screen.findByRole('heading', { name: '1 thing needs you' })).toBeTruthy()

    // To a task; leaving, the home tells the runtime, and is read again from then.
    act(() => router.history.push('/threads/th1'))
    await waitFor(() => expect(projectsAside()).toBeNull())
    await waitFor(() => expect(client.leftHome).toHaveBeenCalled())
    await waitFor(() => expect(services.cache.isFetching()).toBe(0))

    // Meanwhile another call came to wait on the person: the home is out of date, and the runtime is slow to read it again.
    const slow = later<HomeSnapshot>()
    getHome.mockImplementation(() => slow.promise)
    await act(() => services.cache.invalidateQueries({ queryKey: keys.home, refetchType: 'none' }))
    const read = getHome.mock.calls.length

    act(() => router.history.push('/'))
    // The very screen the person left, at once: scrolled where it was.
    await waitFor(() => expect(projectsAside()).toBe(shown))
    await act(glance)
    expect(screen.queryByRole('status', { name: pendingText.home })).toBeNull()
    expect(projectsAside()).toBe(shown)
    // Read again behind it.
    expect(getHome.mock.calls.length).toBe(read + 1)

    // What changed shows as the read lands: both calls now need the person.
    expect(screen.getByRole('heading', { name: '1 thing needs you' })).toBeTruthy()
    act(() => slow.answer(home({ calls: [permission, { ...permission, id: 'a2', title: 'Write outside the worktree', command: null }] })))
    expect(await screen.findByRole('heading', { name: '2 things need you' })).toBeTruthy()
  })

  it('shows the outline only the first time, while the home has never been read', async () => {
    const slow = later<HomeSnapshot>()
    const { client } = fakeClient({ getHome: vi.fn(() => slow.promise) })
    const services = servicesFor(client)
    const router = makeRouter({ client, cache: services.cache }, createMemoryHistory({ initialEntries: ['/'] }))
    render(
      <ServicesProvider value={services}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    )
    expect(await screen.findByRole('status', { name: pendingText.home })).toBeTruthy()
    act(() => slow.answer(home()))
    expect(await screen.findByRole('complementary', { name: 'Projects' })).toBeTruthy()
    expect(screen.queryByRole('status', { name: pendingText.home })).toBeNull()
  })
})
