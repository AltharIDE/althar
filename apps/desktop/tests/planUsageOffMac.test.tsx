import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { fakeClient, fakeHost, planUsage, project } from './fixtures'
import { withServices } from './render'

/*
 * Plan usage's key off a Mac, on Linux here: the kit reads the system once, as
 * it loads, from what the preload gives (foundations/device.ts, keys.ts), so
 * this file is off a Mac from the start, and planUsage.test.tsx stays on one.
 */

vi.hoisted(() => Object.assign(window, { althar: { platform: 'linux' } }))

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

const usageDialog = () => screen.queryByRole('dialog', { name: 'Plan usage' })

describe('opening plan usage off a Mac', () => {
  it('opens on Control-U, and closes on the same key', async () => {
    const router = createRouter({
      routeTree: rootRoute.addChildren([projectRoute]),
      history: createMemoryHistory({ initialEntries: ['/projects/p1'] }),
    })
    const fake = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getPlanUsage: vi.fn(async () => planUsage()),
    })
    withServices(<RouterProvider router={router} />, fake.client, fakeHost({ platform: 'linux' }))
    await screen.findByRole('navigation', { name: 'Projects' })
    // ⌘ is not the key there, and neither is Control with Shift.
    fireEvent.keyDown(window, { key: 'u', metaKey: true })
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true })
    expect(usageDialog()).toBeNull()
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    await screen.findByRole('dialog', { name: 'Plan usage' })
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true })
    await waitFor(() => expect(usageDialog()).toBeNull())
  })
})
