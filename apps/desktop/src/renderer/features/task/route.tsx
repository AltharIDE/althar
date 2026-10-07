import { createRoute, useNavigate } from '@tanstack/react-router'

import { Room, TASK } from '@althar/ui'

import { rootRoute } from '../../root'
import { lanesOf, yoursOf } from '../board/lanes'
import { useBoard } from '../board/useBoard'
import { ProjectBar } from '../project/ProjectBar'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

/** The project's bar over one of its tasks: the task on, after the views; each view goes back to the project in it. */
function TaskNav({ projectId, title }: { projectId: string; title: string }) {
  const navigate = useNavigate()
  const board = useBoard(projectId)
  const lanes = board.board === null ? null : lanesOf(board.board)
  const open = (search: { readonly room?: Room; readonly new?: 'task' }) =>
    void navigate({ to: '/projects/$projectId', params: { projectId }, search })
  return (
    <ProjectBar
      room={TASK}
      task={{ title, onOpen: () => undefined }}
      onRoom={(room) => open({ room })}
      working={lanes === null ? null : lanes.running.filter((task) => task.phase !== 'stopped').length}
      yours={lanes === null ? null : yoursOf(lanes)}
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
  const title = model.snapshot?.task.title
  useVisit(threadId, projectId, title)
  return (
    <TaskView
      // Each task starts on its own face, with nothing typed.
      key={threadId}
      model={model}
      {...(projectId === undefined || title === undefined ? {} : { nav: <TaskNav projectId={projectId} title={title} /> })}
      onBack={() =>
        void (projectId === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId } }))
      }
    />
  )
}

/** A task, by its thread. */
export const taskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: Task })
