import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { useBoard } from '../board/useBoard'
import { useConnections } from '../connections/useConnections'
import { ProjectView } from './ProjectView'
import { useProject } from './useProject'

function Project() {
  const { projectId } = projectRoute.useParams()
  const navigate = useNavigate()
  return (
    <ProjectView
      model={useProject(projectId)}
      board={useBoard(projectId)}
      connections={useConnections()}
      onBack={() => void navigate({ to: '/' })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}

/** A project: the conversation with its coordinator, and the board of its work. */
export const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: Project })
