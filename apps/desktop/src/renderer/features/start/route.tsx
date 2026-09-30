import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { StartView } from './StartView'
import { useStart } from './useStart'

function Start() {
  const navigate = useNavigate()
  return <StartView model={useStart()} onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })} />
}

/** The start: the agents on this Mac, and the projects. */
export const startRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Start })
