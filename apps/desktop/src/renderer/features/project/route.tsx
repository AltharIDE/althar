import { createRoute, useNavigate } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { useBoard } from '../board/useBoard'
import { useLastRoom } from '../tabs/TabsFrame'
import { useConnections } from '../connections/useConnections'
import { isProjectSection, type ProjectSection } from '../projectSettings/sections'
import { useProjectSettings } from '../projectSettings/useProjectSettings'
import { ProjectView } from './ProjectView'
import { useProject } from './useProject'

function Project() {
  const { projectId } = projectRoute.useParams()
  const { room, section } = projectRoute.useSearch()
  const navigate = useNavigate()
  // The view it was last on, unless a task's bar, or a way to one of its settings, asked for one.
  const [last, keepRoom] = useLastRoom(projectId)
  const opening = room ?? last
  // Removed, the project is gone: back to the home.
  const settings = useProjectSettings(projectId, () => void navigate({ to: '/' }))
  return (
    <ProjectView
      {...(opening === null ? {} : { room: opening })}
      onRoomChange={keepRoom}
      model={useProject(projectId)}
      board={useBoard(projectId)}
      connections={useConnections()}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
      settings={{
        model: settings,
        ...(section === undefined ? {} : { section }),
        onConnections: () => void navigate({ to: '/settings/$section', params: { section: 'code-hosts' } }),
      }}
    />
  )
}

/** What a project opens on, when something asks: a view, and of its settings, a section. */
interface ProjectSearch {
  readonly room?: Room
  readonly section?: ProjectSection
}

/** The view an address names, if it names one. */
const roomOf = (value: unknown): Room | undefined => Object.values(Room).find((room) => room === value)

/** A project: the conversation with its coordinator, the board of its work, and its settings. */
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
      cache.fetchQuery(read.repositories(projectId)),
      cache.fetchQuery(read.status()),
      cache.fetchQuery(read.connections()),
    )
  },
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const room = roomOf(search.room)
    return {
      ...(room === undefined ? {} : { room }),
      ...(isProjectSection(search.section) ? { section: search.section } : {}),
    }
  },
})

/** Where one of a project's settings is: its Settings view, at a section. */
export const settingsSearch = (section: ProjectSection): ProjectSearch => ({ room: Room.Settings, section })
