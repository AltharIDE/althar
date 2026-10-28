import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import type { Client } from './data/client'
import { useServices } from './data/services'
import { KeptScreens } from './features/tabs/KeptScreens'
import { TabsFrame } from './features/tabs/TabsFrame'

/*
 * The route every feature's routes hang from, under the window's tabs, with
 * the projects' and tasks' screens the window keeps beside them: a project's
 * or a task's route says which shows. A notification the person clicked
 * opens its thread, wherever the window was.
 */
function Root() {
  const { host } = useServices()
  const navigate = useNavigate()
  useEffect(() => host.onOpen((threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })), [host, navigate])
  return (
    <TabsFrame>
      <Outlet />
      <KeptScreens />
    </TabsFrame>
  )
}

/** What each route reads with before it shows: the runtime's client, and the window's cache of what it read. */
export interface RouterContext {
  readonly client: Client
  readonly cache: QueryClient
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Root })
