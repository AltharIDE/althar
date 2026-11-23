import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServicesProvider } from '../src/renderer/data/services'
import { showingAside } from '../src/renderer/features/project/asked'
import { makeRouter } from '../src/renderer/router'
import { fakeClient, fakeHost, home } from './fixtures'
import { servicesFor } from './render'

/*
 * A prompt a thread raises itself (a computer-use permission, say) brings the window forward and opens its thread, unless the
 * window already shows the aside it is in: there its prompt is in view, and the window stays where the person left it.
 */

const setup = async () => {
  let open: (threadId: string, asked: boolean) => void = () => undefined
  const host = fakeHost({
    onOpen: vi.fn((listener) => {
      open = listener
      return () => undefined
    }),
  })
  const { client } = fakeClient({ getHome: vi.fn(async () => home()) })
  const services = servicesFor(client, host)
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
  const stops: Array<() => void> = []
  afterEach(() => stops.splice(0).forEach((stop) => stop()))

  it('leaves the window where it was while the aside it is in is shown', async () => {
    stops.push(showingAside('th1'))
    const { router, open } = await setup()
    open('th1', true)
    expect(router.state.location.pathname).toBe('/')
  })

  it('goes to the thread when no window shows that aside, so the prompt is seen', async () => {
    stops.push(showingAside('th2'))
    const { router, open } = await setup()
    open('th1', true)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/threads/th1'))
  })

  it('goes to the thread once its aside is no longer shown', async () => {
    showingAside('th1')()
    const { router, open } = await setup()
    open('th1', true)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/threads/th1'))
  })

  it('still opens a thread the person clicked a notification of', async () => {
    stops.push(showingAside('th1'))
    const { router, open } = await setup()
    open('th1', false)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/threads/th1'))
  })
})
