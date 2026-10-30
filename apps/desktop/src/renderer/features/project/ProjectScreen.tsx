import { useNavigate } from '@tanstack/react-router'
import { memo, useCallback } from 'react'

import { Room } from '@althar/ui'

import { useBoard } from '../board/useBoard'
import { useLastRoom } from '../tabs/TabsFrame'
import { useConnections } from '../connections/useConnections'
import { useProjectSettings } from '../projectSettings/useProjectSettings'
import { useSettingsWays } from '../settings/open'
import { ProjectView } from './ProjectView'
import type { ProjectSearch } from './search'
import { useProject } from './useProject'

/**
 * A project's screen, kept while the person is elsewhere (`KeptScreens`):
 * what its address asks, it takes anew at each `visit`.
 */
export const ProjectScreen = memo(function ProjectScreen({
  projectId,
  search: { room, section, automation },
  visit,
}: {
  projectId: string
  search: ProjectSearch
  visit: number
}) {
  const navigate = useNavigate()
  const ways = useSettingsWays()
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
      visit={visit}
      ways={ways}
      model={useProject(projectId)}
      board={useBoard(projectId)}
      connections={useConnections()}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
      settings={{
        model: settings,
        ...(section === undefined ? {} : { section }),
        onConnections: ways.connections,
      }}
    />
  )
})
