import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { useConnections } from '../connections/useConnections'
import { ProjectView } from './ProjectView'
import { useProject } from './useProject'

function Project() {
  const { projectId } = projectRoute.useParams()
  const navigate = useNavigate()
  return (
    <ProjectView
      model={useProject(projectId)}
      connections={useConnections()}
      onBack={() => void navigate({ to: '/' })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}

/** A project: its Talk room, with the coordinator and each task's card. */
export const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: Project })
