import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import type { Client } from './data/client'
import { useServices } from './data/services'
import { TabsFrame } from './features/tabs/TabsFrame'

/*
 * The route every feature's routes hang from, under the window's tabs. A
 * notification the person clicked opens its thread, wherever the window was.
 */
function Root() {
  const { host } = useServices()
  const navigate = useNavigate()
  useEffect(() => host.onOpen((threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })), [host, navigate])
  return (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  )
}

/** What each route reads with before it shows: the runtime's client, and the window's cache of what it read. */
export interface RouterContext {
  readonly client: Client
  readonly cache: QueryClient
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Root })
