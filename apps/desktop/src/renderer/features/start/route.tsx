import { createRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { rootRoute } from '../../root'
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
      onSettings={() => void navigate({ to: '/settings' })}
    />
  )
}

function Start() {
  const navigate = useNavigate()
  const start = useStart()
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
  validateSearch: (search: Record<string, unknown>): { readonly open?: 'folder' } => (search.open === 'folder' ? { open: 'folder' } : {}),
})
