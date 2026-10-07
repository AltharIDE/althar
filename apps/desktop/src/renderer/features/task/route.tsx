import { createRoute, useNavigate } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { rootRoute } from '../../root'
import { lanesOf, yoursOf } from '../board/lanes'
import { useBoard } from '../board/useBoard'
import { ProjectBar } from '../project/ProjectBar'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

/** The project's bar over one of its tasks: no view on; each goes back to the project in it. */
function TaskNav({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const board = useBoard(projectId)
  const lanes = board.board === null ? null : lanesOf(board.board)
  const open = (search: { readonly room?: Room; readonly new?: 'task' }) =>
    void navigate({ to: '/projects/$projectId', params: { projectId }, search })
  return (
    <ProjectBar
      room={null}
      onRoom={(room) => open({ room })}
      working={lanes === null ? 0 : lanes.running.filter((task) => task.phase !== 'stopped').length}
      yours={lanes === null ? 0 : yoursOf(lanes)}
      onYours={() => open({ room: Room.Both })}
      onRules={() => void navigate({ to: '/projects/$projectId/rules', params: { projectId } })}
      onNewTask={() => open({ new: 'task' })}
    />
  )
}

function Task() {
  const { threadId } = taskRoute.useParams()
  const navigate = useNavigate()
  const model = useTask(threadId)
  const projectId = model.snapshot?.project.id
  useVisit(threadId, projectId)
  return (
    <TaskView
      // Each task starts on its own face, with nothing typed.
      key={threadId}
      model={model}
      {...(projectId === undefined ? {} : { nav: <TaskNav projectId={projectId} /> })}
      onBack={() =>
        void (projectId === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId } }))
      }
    />
  )
}

/** A task, by its thread. */
export const taskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: Task })
