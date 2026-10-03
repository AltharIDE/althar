import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useServices } from './data/services'

/* The route every feature's routes hang from. A notification the person clicked opens its thread, wherever the window was. */
function Root() {
  const { host } = useServices()
  const navigate = useNavigate()
  useEffect(() => host.onOpen((threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })), [host, navigate])
  return <Outlet />
}

export const rootRoute = createRootRoute({ component: Root })
