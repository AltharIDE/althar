import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { fakeClient, fakeHost, planUsage, project } from './fixtures'
import { withServices } from './render'

/*
 * The plan gauge's peek off a Mac, on Linux here: Control U opens and closes it.
 */

/* The kit reads its system once, from the preload, as it loads: say Linux before it does. */
vi.hoisted(() => {
  ;(window as { althar?: { platform?: string } }).althar = { platform: 'linux' }
})

vi.mock('@althar/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@althar/ui')>()
  const { keysFor } = await import('./mockKeys')
  return { ...actual, ...keysFor('linux') }
})

const rootRoute = createRootRoute({
  component: () => (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  ),
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: () => <textarea aria-label="Message the lead" />,
})

const peek = () => screen.queryByRole('dialog', { name: 'Plan usage' })

// The fixture's windows read at its own time: one past its reset is no longer shown.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-15T10:05:00.000Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the plan gauge in the bar, off a Mac', () => {
  it('opens on Control-U, and closes on the same key', async () => {
    const router = createRouter({
      routeTree: rootRoute.addChildren([projectRoute]),
      history: createMemoryHistory({ initialEntries: ['/projects/p1'] }),
    })
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getPlanUsage: vi.fn(async () => planUsage()),
    })
    withServices(<RouterProvider router={router} />, client, fakeHost({ platform: 'linux' }))
    await screen.findByRole('button', { name: /^Plan usage: / })
    // ⌘ is not the key there, and neither is Control with Shift.
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true })
    expect(peek()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true })
    await waitFor(() => expect(peek()).toBeNull())
  })
})
