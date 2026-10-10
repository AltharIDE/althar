import { createRoute, redirect, useNavigate } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { useWhenRemoved } from '../project/useProjectMenu'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

/** One task's screen: everything it reads is its own, from the first render. */
function TaskScreen({ threadId }: { threadId: string }) {
  const navigate = useNavigate()
  const model = useTask(threadId)
  const project = model.snapshot?.project
  useVisit(threadId, project?.id)
  // Its project removed, from here or another window: home.
  useWhenRemoved(project?.id, () => void navigate({ to: '/' }))
  // Back to the project, which opens on the view it was last on.
  const back = () =>
    void (project === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId: project.id } }))
  return <TaskView model={model} onBack={back} />
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
  // A coordinator's thread, as a question it asks opens from the home, a notification or the edge, is its project's conversation.
  beforeLoad: async ({ context: { client, cache }, params: { threadId } }) => {
    const listed = await cache.fetchQuery(reads(client).projects()).catch(() => null)
    const project = listed?.projects.find((one) => one.coordinatorThreadId === threadId)
    if (project !== undefined)
      throw redirect({ to: '/projects/$projectId', params: { projectId: project.id }, search: { room: Room.Talk } })
  },
  // The thread and the agents, so it shows whole from the first frame.
  loader: async ({ context: { client, cache }, params: { threadId } }) => {
    const read = reads(client)
    await Promise.allSettled([cache.fetchQuery(read.thread(threadId)), cache.fetchQuery(read.status())])
  },
})
