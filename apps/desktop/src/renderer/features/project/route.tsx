import { createRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

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
  const { room, section, automation } = projectRoute.useSearch()
  const navigate = useNavigate()
  /** The address, changed in place: what a reload opens on. */
  const address = useCallback(
    (change: (was: ProjectSearch) => ProjectSearch) =>
      void navigate({ to: '/projects/$projectId', params: { projectId }, search: change, replace: true }),
    [navigate, projectId],
  )
  // The automation open in Automations is the address's, so it is open again after a reload; back on the tab, the view last on says.
  const keepAutomation = useCallback(
    (open: string | null) => {
      if (open === (automation ?? null)) return
      address(({ automation: _automation, room: was, ...rest }) =>
        open === null
          ? { ...rest, ...(was === undefined || was === Room.Automations ? {} : { room: was }) }
          : { ...rest, room: Room.Automations, automation: open },
      )
    },
    [address, automation],
  )
  // The view it was last on, unless a task's bar, or a way to one of its settings, asked for one.
  const [last, keepView] = useLastRoom(projectId)
  // Left for another view, Automations is no longer what the address opens on.
  const keepRoom = useCallback(
    (next: Room) => {
      keepView(next)
      if (room === Room.Automations && next !== Room.Automations) address(({ room: _room, ...rest }) => rest)
    },
    [keepView, room, address],
  )
  const opening = room ?? last
  // Removed, the project is gone: back to the home.
  const settings = useProjectSettings(projectId, () => void navigate({ to: '/' }))
  return (
    <ProjectView
      {...(opening === null ? {} : { room: opening })}
      onRoomChange={keepRoom}
      {...(automation === undefined ? {} : { automation })}
      onAutomationChange={keepAutomation}
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

/** What a project opens on, when something asks: a view, of its settings a section, and of its automations the one open, or `new`. */
interface ProjectSearch {
  readonly room?: Room
  readonly section?: ProjectSection
  readonly automation?: string
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
      cache.fetchQuery(read.automations(projectId)),
    )
  },
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const room = roomOf(search.room)
    return {
      ...(room === undefined ? {} : { room }),
      ...(isProjectSection(search.section) ? { section: search.section } : {}),
      ...(typeof search.automation === 'string' && search.automation !== '' ? { automation: search.automation } : {}),
    }
  },
})

/** Where one of a project's settings is: its Settings view, at a section. */
export const settingsSearch = (section: ProjectSection): ProjectSearch => ({ room: Room.Settings, section })
