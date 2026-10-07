import { createRoute, useNavigate } from '@tanstack/react-router'

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
  return (
    <StartView
      model={start}
      onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      home={() => <Home start={start} />}
    />
  )
}

/** Where the window starts: the first screen with no project yet, the home once there are. */
export const startRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Start })
