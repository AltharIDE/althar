import { createRoute, redirect } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { held, keys, readFirst, reads, threadReads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { useShown } from '../tabs/kept'

/**
 * The task on show: each task has a screen of its own, so nothing read for
 * the one before, its face or which project it is in, carries over to it;
 * kept while the person is elsewhere and shown again as they come back (`KeptScreens`).
 */
function Task() {
  const { threadId } = taskRoute.useParams()
  useShown({ kind: 'thread', threadId })
  return null
}

/** A task, by its thread. */
export const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/threads/$threadId',
  component: Task,
  pendingComponent: ThreadPending,
  // A coordinator's thread, as a question it asks opens from the home, a notification or the edge, is its project's conversation.
  // One the window holds as a task's is none, and goes on at once.
  beforeLoad: async ({ context: { client, cache }, params: { threadId } }) => {
    if (cache.getQueryData(keys.thread(threadId)) !== undefined) return
    const listed = await cache.fetchQuery(reads(client).projects()).catch(() => null)
    const project = listed?.projects.find((one) => one.coordinatorThreadId === threadId)
    if (project !== undefined)
      throw redirect({ to: '/projects/$projectId', params: { projectId: project.id }, search: { room: Room.Talk } })
  },
  // The thread and the agents, so it shows whole from the first frame; one the window holds shows at once, and is read again behind it.
  loader: ({ context: { client, cache }, params: { threadId } }) =>
    readFirst(...threadReads(reads(client), threadId).map((options) => held(cache, options))),
})
