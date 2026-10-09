import { createRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { HomePending } from '../../shared/Pending'
import { useAccountSignIn } from '../accounts/useAccountSignIn'
import { HomeView } from '../home/HomeView'
import { useHome } from '../home/useHome'
import { StartView } from './StartView'
import { type StartModel, useStart } from './useStart'

function Home({ start }: { start: StartModel }) {
  const navigate = useNavigate()
  return (
    <HomeView
      model={useHome()}
      start={start}
      onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}

function Start() {
  const navigate = useNavigate()
  const start = useStart()
  const accounts = useAccountSignIn(start)
  // The window's tabs ask for a folder here: the picker opens once, and the address forgets it.
  const { open } = startRoute.useSearch()
  const { openFolder } = start
  useEffect(() => {
    if (open !== 'folder') return
    void navigate({ to: '/', search: {}, replace: true })
    void openFolder().then((opened) => {
      if (opened !== null) void navigate({ to: '/projects/$projectId', params: { projectId: opened.id } })
    })
  }, [open, openFolder, navigate])
  return (
    <StartView
      model={start}
      accounts={accounts}
      onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      home={() => <Home start={start} />}
    />
  )
}

/** Where the window starts: the first screen with no project yet, the home once there are. `open=folder` asks for a folder to open. */
export const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Start,
  pendingComponent: HomePending,
  // The projects and the agents, and, once there are projects, the home.
  loader: async ({ context: { client, cache } }) => {
    const read = reads(client)
    const [listed] = await Promise.allSettled([cache.fetchQuery(read.projects()), cache.fetchQuery(read.status())])
    if (listed.status === 'fulfilled' && listed.value.projects.length > 0) await cache.fetchQuery(read.home()).catch(() => undefined)
  },
  validateSearch: (search: Record<string, unknown>): { readonly open?: 'folder' } => (search.open === 'folder' ? { open: 'folder' } : {}),
})
