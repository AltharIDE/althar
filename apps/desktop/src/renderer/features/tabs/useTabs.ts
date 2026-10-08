import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { ProjectTab } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { arrived, closed, tabsStoreOf } from './store'
import { afterClosing, firstOpen, type Place, tabOf, whereOf, yoursIn } from './tabs'

/*
 * The window's tabs: one for each project the person keeps open, with where
 * in each they last were, so pressing a tab goes back there. Going into a
 * project, from anywhere, gives it a tab. Every project's tab says whether
 * a task is under way there and what waits on the person, as the window's
 * projects are read: again whenever a project, a task, a run, a session or a
 * call changes.
 */

export interface TabsModel {
  readonly tabs: ReadonlyArray<ProjectTab>
  /** The projects without a tab. */
  readonly others: ReadonlyArray<ProjectTab>
  /** The project whose tab has the window; null for the home. */
  readonly current: string | null
  /** What waits on the person across every project. */
  readonly yours: number
  readonly select: (id: string | null) => void
  readonly close: (id: string) => void
  readonly open: (id: string) => void
  /** Asks for a folder to open as a new project, on the home. */
  readonly openFolder: () => void
  /** A task was read: its project's tab has the window while it does. */
  readonly visit: (threadId: string, projectId: string) => void
}

export const useTabs = (): TabsModel => {
  const { client } = useServices()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const store = tabsStoreOf(client)
  const { kept, threads } = useSyncExternalStore(store.subscribe, store.get)
  // Unread, or not read this time, the tabs keep what they last showed.
  const projects = useQuery(reads(client).projects()).data?.projects ?? null

  const where = whereOf(pathname)
  const known = where.kind === 'home' ? null : where.kind === 'project' ? where.projectId : threads[where.threadId]
  // A task whose project isn't read yet keeps the tab that had the window.
  const [shown, setShown] = useState<string | null>(null)
  if (known !== undefined && known !== shown) setShown(known)
  const current = known === undefined ? shown : known

  // The first time, before anything was kept, or once none of it is a project any more: the projects where something goes on.
  // The one with the window stays, though a list read before it was made doesn't have it yet.
  useEffect(() => {
    if (projects === null) return
    const ids = new Set(projects.map((project) => project.id))
    if (current !== null) ids.add(current)
    store.seed(firstOpen(projects), ids)
  }, [store, projects, current])

  // Going into a project, or one of its tasks, gives it a tab and keeps where in it the window is.
  const seeded = kept !== null
  const projectId = known ?? undefined
  // Its rules or its repositories, as the place to come back to; a task's place is its thread.
  const page = where.kind === 'project' ? where.place.kind : 'project'
  const threadId = where.kind === 'thread' ? where.threadId : undefined
  useEffect(() => {
    if (projectId === undefined || !seeded) return
    store.change(
      arrived(
        projectId,
        threadId !== undefined
          ? { kind: 'thread', threadId }
          : page === 'rules' || page === 'repositories'
            ? { kind: page }
            : { kind: 'project' },
      ),
    )
  }, [store, projectId, page, threadId, seeded])

  const go = useCallback(
    (id: string | null, places: Readonly<Record<string, Place>>) => {
      if (id === null) return void navigate({ to: '/' })
      const at = places[id] ?? { kind: 'project' }
      switch (at.kind) {
        case 'project':
          return void navigate({ to: '/projects/$projectId', params: { projectId: id } })
        case 'rules':
          return void navigate({ to: '/projects/$projectId/rules', params: { projectId: id } })
        case 'repositories':
          return void navigate({ to: '/projects/$projectId/repositories', params: { projectId: id } })
        case 'thread':
          return void navigate({ to: '/threads/$threadId', params: { threadId: at.threadId } })
      }
    },
    [navigate],
  )

  const byId = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project])), [projects])
  // A project removed since keeps no tab.
  const open = (kept?.open ?? []).filter((id) => projects === null || byId.has(id))
  const tabs = open.flatMap((id) => {
    const project = byId.get(id)
    return project === undefined ? [] : [tabOf(project)]
  })
  const places = kept?.places ?? {}

  return {
    tabs,
    others: (projects ?? []).filter((project) => !open.includes(project.id)).map(tabOf),
    current,
    yours: (projects ?? []).reduce((sum, project) => sum + yoursIn(project), 0),
    select: (id) => go(id, places),
    close: (id) => {
      store.change(closed(id))
      if (id === current) go(afterClosing(open, id), places)
    },
    open: (id) => {
      store.change((was) => ({ ...was, open: was.open.includes(id) ? was.open : [...was.open, id] }))
      go(id, places)
    },
    openFolder: () => void navigate({ to: '/', search: { open: 'folder' } }),
    visit: store.visit,
  }
}
