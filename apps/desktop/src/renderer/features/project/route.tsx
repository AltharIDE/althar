import { createRoute, useNavigate } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { useBoard } from '../board/useBoard'
import { useLastTask } from '../tabs/TabsFrame'
import { useConnections } from '../connections/useConnections'
import { ProjectView } from './ProjectView'
import { useProject } from './useProject'

function Project() {
  const { projectId } = projectRoute.useParams()
  const { room, new: planning } = projectRoute.useSearch()
  const navigate = useNavigate()
  const last = useLastTask(projectId)
  return (
    <ProjectView
      lastTask={
        last === null
          ? null
          : { title: last.title, onOpen: () => void navigate({ to: '/threads/$threadId', params: { threadId: last.threadId } }) }
      }
      {...(room === undefined ? {} : { room })}
      newTask={planning === 'task'}
      model={useProject(projectId)}
      board={useBoard(projectId)}
      connections={useConnections()}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
      onRules={() => void navigate({ to: '/projects/$projectId/rules', params: { projectId } })}
    />
  )
}

/** What a project opens on, when a task's bar asks: a view, and planning a new task. */
interface ProjectSearch {
  readonly room?: Room
  readonly new?: 'task'
}

/** The view an address names, if it names one. */
const roomOf = (value: unknown): Room | undefined => Object.values(Room).find((room) => room === value)

/** A project: the conversation with its coordinator, and the board of its work. */
export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: Project,
  pendingComponent: ThreadPending,
  // Another project is another screen, with nothing of this one's kept: what was typed, what was open.
  remountDeps: ({ params }) => params.projectId,
  loader: ({ context: { client, cache }, params: { projectId } }) => {
    const read = reads(client)
    return readFirst(
      cache.fetchQuery(read.projects()),
      cache.fetchQuery(read.coordinator(projectId)),
      cache.fetchQuery(read.board(projectId)),
      cache.fetchQuery(read.rules(projectId)),
      cache.fetchQuery(read.status()),
      cache.fetchQuery(read.connections()),
    )
  },
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const room = roomOf(search.room)
    return { ...(room === undefined ? {} : { room }), ...(search.new === 'task' ? { new: 'task' as const } : {}) }
  },
})
