import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { ProjectView } from './ProjectView'
import { useProject } from './useProject'

function Project() {
  const { projectId } = projectRoute.useParams()
  const navigate = useNavigate()
  return (
    <ProjectView
      model={useProject(projectId)}
      onBack={() => void navigate({ to: '/' })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}

/** A project: its tasks, and starting one. */
export const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: Project })
