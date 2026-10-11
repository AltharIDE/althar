import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { type ProjectTab, Room } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { kitInk } from '../../shared/inks'
import { draftActions, draftsOf, inkOf } from '../newProject/draft'
import { arrived, closed, tabsStoreOf } from './store'
import { afterClosing, firstOpen, type Place, tabOf, whereOf, yoursIn } from './tabs'

/*
 * The window's tabs: one for each project the person keeps open, with where
 * in each they last were, so pressing a tab goes back there. Going into a
 * project, from anywhere, gives it a tab. Every project's tab says whether
 * a task is under way there and what waits on the person, as the window's
 * projects are read: again whenever a project, a task, a run, a session or a
 * call changes. A project being made has a tab of its own, at the end, as a
 * browser's new tab; made, it becomes the project's tab, which has the
 * project's id already.
 */

export const text = {
  /** A new project's tab, before it is named. */
  newProject: 'New project',
}

export interface TabsModel {
  readonly tabs: ReadonlyArray<ProjectTab>
  /** The projects without a tab. */
  readonly others: ReadonlyArray<ProjectTab>
  /** The project whose tab has the window; null for the home. */
  readonly current: string | null
  /** What waits on the person across every project. */
  readonly yours: number
  /** There is no project at all yet, as read: the first screen has the whole window. */
  readonly none: boolean
  readonly select: (id: string | null) => void
  readonly close: (id: string) => void
  readonly open: (id: string) => void
  /** Starts a new project in a tab of its own, or goes to the one being made; folders dropped are added to it. */
  readonly newProject: (files?: ReadonlyArray<File>) => void
  /** The new project was made: its tab is the project's own, open on its conversation. */
  readonly made: (projectId: string) => void
  /** The new project's tab closes, and nothing is made. */
  readonly closeNew: () => void
  /** A task was read: its project's tab has the window while it does. */
  readonly visit: (threadId: string, projectId: string) => void
}

export const useTabs = (): TabsModel => {
  const services = useServices()
  const { client } = services
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const store = tabsStoreOf(client)
  const { kept, threads } = useSyncExternalStore(store.subscribe, store.get)
  const drafts = draftsOf(client)
  const draft = useSyncExternalStore(drafts.subscribe, drafts.get)
  // Unread, or not read this time, the tabs keep what they last showed.
  const projects = useQuery(reads(client).projects()).data?.projects ?? null

  const where = whereOf(pathname)
  const known = where.kind === 'home' || where.kind === 'new' ? null : where.kind === 'project' ? where.projectId : threads[where.threadId]
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
    (id: string | null, places: Readonly<Record<string, Place>>): Promise<void> => {
      if (id === null) return navigate({ to: '/' })
      const at = places[id] ?? { kind: 'project' }
      switch (at.kind) {
        case 'project':
          return navigate({ to: '/projects/$projectId', params: { projectId: id } })
        case 'rules':
          return navigate({ to: '/projects/$projectId/rules', params: { projectId: id } })
        case 'repositories':
          return navigate({ to: '/projects/$projectId/repositories', params: { projectId: id } })
        case 'thread':
          return navigate({ to: '/threads/$threadId', params: { threadId: at.threadId } })
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
  // The project being made, at the end; once made, its own tab has its id, and stands in its place.
  const making: ProjectTab | null =
    draft === null || draft.made || open.includes(draft.id)
      ? null
      : {
          id: draft.id,
          name: draft.name.trim() === '' ? text.newProject : draft.name.trim(),
          seed: draft.id,
          ink: kitInk(inkOf(draft, projects ?? [])),
          running: false,
          yours: 0,
        }
  const onNew = where.kind === 'new'

  /** Ends the draft once the window has left its tab, so its page stays until the next one shows. */
  const leaving = (id: string, going: Promise<void>) =>
    void going.finally(() => {
      if (drafts.get()?.id === id) drafts.end()
    })

  const closeNew = () => {
    if (draft === null) return
    if (!onNew) return drafts.end()
    leaving(draft.id, go(afterClosing([...open, draft.id], draft.id), places))
  }

  return {
    tabs: making === null ? tabs : [...tabs, making],
    others: (projects ?? []).filter((project) => !open.includes(project.id)).map(tabOf),
    current: onNew ? (draft?.id ?? null) : current,
    yours: (projects ?? []).reduce((sum, project) => sum + yoursIn(project), 0),
    none: projects !== null && projects.length === 0,
    select: (id) => {
      if (id !== null && id === making?.id) return void navigate({ to: '/new' })
      void go(id, places)
    },
    close: (id) => {
      if (id === making?.id) return closeNew()
      store.change(closed(id))
      if (id === current && !onNew) void go(afterClosing(open, id), places)
    },
    open: (id) => {
      store.change((was) => ({ ...was, open: was.open.includes(id) ? was.open : [...was.open, id] }))
      void go(id, places)
    },
    newProject: (files) => {
      drafts.start()
      void navigate({ to: '/new' })
      if (files !== undefined && files.length > 0) void draftActions(services).drop(files)
    },
    made: (projectId) => {
      store.change(arrived(projectId, { kind: 'project' }))
      drafts.change(projectId, (now) => ({ ...now, made: true }))
      leaving(projectId, navigate({ to: '/projects/$projectId', params: { projectId }, search: { room: Room.Talk } }))
    },
    closeNew,
    visit: store.visit,
  }
}
