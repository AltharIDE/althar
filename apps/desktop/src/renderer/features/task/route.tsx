import { createRoute, useNavigate } from '@tanstack/react-router'

import type { AgentStatus } from '@althar/contracts'

import { reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { lanesOf, yoursOf } from '../board/lanes'
import { firstNeedOf, needsOf } from '../board/needs'
import { useBoard } from '../board/useBoard'
import { ProjectBar } from '../project/ProjectBar'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

/** The project's bar over one of its tasks: the way back to the project, on the view it was on, and which task this is. */
function TaskNav({
  threadId,
  projectId,
  project,
  title,
  agents,
  onBack,
}: {
  /** The task on screen: listed among what needs the person, but not opened again. */
  threadId: string
  projectId: string
  project: string
  title: string
  agents: ReadonlyArray<AgentStatus>
  onBack: () => void
}) {
  const navigate = useNavigate()
  const board = useBoard(projectId)
  const lanes = board.board === null ? null : lanesOf(board.board)
  const openTask = (threadId: string) => void navigate({ to: '/threads/$threadId', params: { threadId } })
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  // The first that isn't this task: with nothing else, the count only says how many.
  const first = lanes === null ? null : firstNeedOf(lanes, threadId)
  return (
    <ProjectBar
      place={{ back: { project, task: title, onBack } }}
      working={lanes === null ? null : lanes.running.filter((task) => task.phase !== 'stopped').length}
      yours={lanes === null ? null : yoursOf(lanes)}
      {...(lanes === null ? {} : { needs: needsOf(lanes, name, openTask, threadId) })}
      {...(first === null ? {} : { onYours: () => openTask(first) })}
      onRules={() => void navigate({ to: '/projects/$projectId/rules', params: { projectId } })}
      onNewTask={() => void navigate({ to: '/projects/$projectId', params: { projectId }, search: { new: 'task' } })}
    />
  )
}

/** One task's screen: everything it reads is its own, from the first render. */
function TaskScreen({ threadId }: { threadId: string }) {
  const navigate = useNavigate()
  const model = useTask(threadId)
  const project = model.snapshot?.project
  const title = model.snapshot?.task.title
  useVisit(threadId, project?.id)
  // Back to the project, which opens on the view it was last on.
  const back = () =>
    void (project === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId: project.id } }))
  return (
    <TaskView
      model={model}
      {...(project === undefined || title === undefined
        ? {}
        : {
            nav: (
              <TaskNav
                threadId={threadId}
                projectId={project.id}
                project={project.name}
                title={title}
                agents={model.agents}
                onBack={back}
              />
            ),
          })}
      onBack={back}
    />
  )
}

function Task() {
  const { threadId } = taskRoute.useParams()
  // The router keeps this screen from one task to the next, so each task gets a screen of its own: nothing read for the
  // one before, its face or which project it is in, carries over to it.
  return <TaskScreen key={threadId} threadId={threadId} />
}

/** A task, by its thread. */
export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/threads/$threadId',
  component: Task,
  pendingComponent: ThreadPending,
  remountDeps: ({ params }) => params.threadId,
  // The thread and the agents, then its project's board, for the bar over it.
  loader: async ({ context: { client, cache }, params: { threadId } }) => {
    const read = reads(client)
    const [thread] = await Promise.allSettled([cache.fetchQuery(read.thread(threadId)), cache.fetchQuery(read.status())])
    if (thread.status === 'fulfilled') await cache.fetchQuery(read.board(thread.value.project.id)).catch(() => undefined)
  },
})
