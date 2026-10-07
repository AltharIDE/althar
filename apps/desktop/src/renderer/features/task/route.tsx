import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

function Task() {
  const { threadId } = taskRoute.useParams()
  const navigate = useNavigate()
  const model = useTask(threadId)
  const projectId = model.snapshot?.project.id
  useVisit(threadId, projectId)
  return (
    <TaskView
      model={model}
      onBack={() =>
        void (projectId === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId } }))
      }
    />
  )
}

/** A task, by its thread. */
export const taskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: Task })
