import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectSummary } from '@althar/contracts'
import { Room } from '@althar/ui'

import { TabsFrame, useLastRoom, useVisit } from '../src/renderer/features/tabs/TabsFrame'
import { afterClosing, beside, byNumber, firstOpen, keptFrom, whereOf } from '../src/renderer/features/tabs/tabs'
import { changed, fakeClient, project } from './fixtures'
import { withServices } from './render'

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'halyard', slug: 'halyard', running: 0, working: 0, waiting: 0, ready: 0 }
const tessera: ProjectSummary = { ...project, id: 'p3', name: 'tessera', slug: 'tessera', running: 0, working: 0, waiting: 1, ready: 1 }

/* The app's places, with screens that only say where they are; a task's says its project, as the task screen does once it reads it. */
const THREADS: Readonly<Record<string, string>> = { th1: 'p1', th9: 'p2' }
function Where() {
  return <p data-testid="where">{useRouterState({ select: (state) => state.location.pathname })}</p>
}
function Thread() {
  const { threadId } = threadRoute.useParams()
  useVisit(threadId, THREADS[threadId])
  return <Where />
}
/* A project's screen names the view it was last on, as it opens on it, and changes view. */
function ProjectScreen() {
  const { projectId } = projectRoute.useParams()
  const [last, keep] = useLastRoom(projectId)
  return (
    <>
      <Where />
      <p data-testid="last">{last ?? 'none'}</p>
      <button type="button" onClick={() => keep(Room.Board)}>
        To the board
      </button>
    </>
  )
}
const rootRoute = createRootRoute({
  component: () => (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  ),
})
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Where })
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: ProjectScreen })
const rulesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId/rules', component: Where })
const threadRoute = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: Thread })

const windowAt = (path: string, projects: ReadonlyArray<ProjectSummary> = [project, halyard, tessera]) => {
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, rulesRoute, threadRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { client, emit } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 3, projects })) })
  withServices(<RouterProvider router={router} />, client)
  const go = (to: string) => act(() => router.history.push(to))
  return { client, emit, go, router }
}

const nav = () => within(screen.getByRole('navigation', { name: 'Projects' }))
const tab = (name: string) => nav().getByRole('button', { name: new RegExp(`^${name}`) })
const where = () => screen.getByTestId('where').textContent
/** Each tab as it is read out: its name, then what goes on there. */
const names = () =>
  nav()
    .getAllByRole('listitem')
    .map((item) => {
      const [select] = within(item).getAllByRole('button')
      return [...(select?.childNodes ?? [])]
        .filter((node) => !(node instanceof HTMLElement && node.getAttribute('aria-hidden') === 'true'))
        .map((node) => node.textContent)
        .join('')
    })

beforeEach(() => window.localStorage.clear())

describe('the window’s tabs', () => {
  it('open with the projects where something goes on, and go back to where each was', async () => {
    const { go } = windowAt('/')
    // Meridian runs a task; Tessera has a call and a ready task. Halyard is quiet, so it waits under the +.
    await waitFor(() => expect(names()).toEqual(['Home, 2 calls wait on you', 'meridian, work running', 'tessera, 2 calls wait on you']))
    expect(tab('Home').getAttribute('aria-current')).toBe('page')

    // Into a task of Meridian's, then home: Meridian's tab goes back to the task.
    go('/threads/th1')
    await waitFor(() => expect(tab('meridian').getAttribute('aria-current')).toBe('page'))
    await userEvent.click(tab('Home'))
    expect(where()).toBe('/')
    await userEvent.click(tab('meridian'))
    expect(where()).toBe('/threads/th1')

    // The + gives Halyard a tab, at the end, and takes the window there.
    await userEvent.click(nav().getByRole('button', { name: 'Open a project' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'halyard' }))
    expect(where()).toBe('/projects/p2')
    expect(names()).toEqual(['Home, 2 calls wait on you', 'meridian, work running', 'tessera, 2 calls wait on you', 'halyard'])

    // Kept for the next launch.
    expect(keptFrom(window.localStorage.getItem('althar.tabs'))).toEqual({
      open: ['p1', 'p3', 'p2'],
      places: { p1: { kind: 'thread', threadId: 'th1' }, p2: { kind: 'project' } },
    })
  })

  it('go by ⌘ and a number, and Control-Tab, and close to the next', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: ['p1', 'p2', 'p3'], places: { p3: { kind: 'rules' } } }))
    windowAt('/projects/p2')
    await waitFor(() => expect(tab('halyard').getAttribute('aria-current')).toBe('page'))
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    await waitFor(() => expect(where()).toBe('/'))
    fireEvent.keyDown(window, { key: '9', metaKey: true })
    await waitFor(() => expect(where()).toBe('/projects/p3/rules'))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() => expect(where()).toBe('/'))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(where()).toBe('/projects/p3/rules'))
    fireEvent.keyDown(window, { key: '2', metaKey: true })
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    // Typing a number isn't a shortcut, nor a number with no tab.
    fireEvent.keyDown(window, { key: '3' })
    fireEvent.keyDown(window, { key: '7', metaKey: true })
    expect(where()).toBe('/projects/p1')

    await userEvent.click(nav().getByRole('button', { name: 'Close meridian' }))
    await waitFor(() => expect(where()).toBe('/projects/p2'))
    expect(nav().queryByRole('button', { name: /^meridian/ })).toBeNull()
    // Closing one without the window leaves the window where it is.
    await userEvent.click(nav().getByRole('button', { name: 'Close tessera' }))
    expect(where()).toBe('/projects/p2')
    await userEvent.click(nav().getByRole('button', { name: 'Close halyard' }))
    await waitFor(() => expect(where()).toBe('/'))
  })

  it('keep the tab that had the window while a task is read, give a project reached from anywhere a tab, and show its work as it changes', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: ['p1'], places: {} }))
    const { go, client, emit } = windowAt('/projects/p1')
    await waitFor(() => expect(tab('meridian').getAttribute('aria-current')).toBe('page'))
    // A task not read yet, of another project: the tab stays, then Halyard's opens once it is.
    go('/threads/th8')
    expect(tab('meridian').getAttribute('aria-current')).toBe('page')
    go('/threads/th9')
    await waitFor(() => expect(tab('halyard').getAttribute('aria-current')).toBe('page'))

    vi.mocked(client.listProjects).mockResolvedValue({ cursor: 4, projects: [project, { ...halyard, waiting: 3 }] })
    emit(changed('attention_request', 'a1'))
    await waitFor(() => expect(tab('halyard, 3 calls wait on you')).toBeTruthy())
    // What changes elsewhere doesn't read them again.
    emit(changed('thread_item', 'i1'))
    expect(client.listProjects).toHaveBeenCalledTimes(2)
  })

  it('forget projects removed since, and open the busy ones when none of what was kept is left', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: ['gone', 'p2'], places: { gone: { kind: 'project' } } }))
    windowAt('/')
    await waitFor(() => expect(names()).toEqual(['Home, 2 calls wait on you', 'halyard']))
    await waitFor(() => expect(keptFrom(window.localStorage.getItem('althar.tabs'))).toEqual({ open: ['p2'], places: {} }))
  })

  it('open the busy projects when none of the tabs kept is a project any more', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: ['gone', 'also-gone'], places: {} }))
    windowAt('/')
    await waitFor(() => expect(names()).toEqual(['Home, 2 calls wait on you', 'meridian, work running', 'tessera, 2 calls wait on you']))
  })

  it('remember the view each project was last on, to open on it again back from a task', async () => {
    const { go } = windowAt('/projects/p1')
    await waitFor(() => expect(screen.getByTestId('last').textContent).toBe('none'))
    await userEvent.click(await screen.findByRole('button', { name: 'To the board' }))
    go('/threads/th1')
    await waitFor(() => expect(tab('meridian').getAttribute('aria-current')).toBe('page'))
    go('/projects/p1')
    await waitFor(() => expect(screen.getByTestId('last').textContent).toBe('board'))
    expect(keptFrom(window.localStorage.getItem('althar.tabs'))?.rooms).toEqual({ p1: 'board' })
    // Another project hasn't been on one.
    go('/projects/p2')
    await waitFor(() => expect(screen.getByTestId('last').textContent).toBe('none'))
  })

  it('offer a folder from the +, on the home', async () => {
    const { router } = windowAt('/projects/p1', [project])
    await userEvent.click(await screen.findByRole('button', { name: 'Open a project' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Open a folder…' }))
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toEqual({ open: 'folder' })
  })
})

describe('working out the tabs', () => {
  it('reads where the window is from its address', () => {
    expect(whereOf('/')).toEqual({ kind: 'home' })
    expect(whereOf('/settings')).toEqual({ kind: 'home' })
    expect(whereOf('/projects/p%201')).toEqual({ kind: 'project', projectId: 'p 1', place: { kind: 'project' } })
    expect(whereOf('/projects/p1/memory')).toEqual({ kind: 'project', projectId: 'p1', place: { kind: 'memory' } })
    expect(whereOf('/projects/p1/rules')).toEqual({ kind: 'project', projectId: 'p1', place: { kind: 'rules' } })
    expect(whereOf('/projects/p1/repositories')).toEqual({ kind: 'project', projectId: 'p1', place: { kind: 'repositories' } })
    expect(whereOf('/projects/p1/other')).toEqual({ kind: 'home' })
    expect(whereOf('/threads/th1')).toEqual({ kind: 'thread', threadId: 'th1' })
  })

  it('opens the busy projects first, else the one worked in last', () => {
    expect(firstOpen([halyard, tessera, project])).toEqual(['p3', 'p1'])
    const old = { ...halyard, id: 'old', lastWorkAt: '2026-09-01T00:00:00.000Z' }
    const recent = { ...halyard, id: 'recent', lastWorkAt: '2026-10-01T00:00:00.000Z' }
    expect(firstOpen([old, recent, { ...halyard, lastWorkAt: null }])).toEqual(['recent'])
    expect(firstOpen([{ ...halyard, lastWorkAt: null }])).toEqual([])
  })

  it('finds the next tab on closing, by number, and beside', () => {
    expect(afterClosing(['a', 'b', 'c'], 'b')).toBe('c')
    expect(afterClosing(['a', 'b', 'c'], 'c')).toBe('b')
    expect(afterClosing(['a'], 'a')).toBeNull()
    expect([1, 2, 3, 4, 9].map((n) => byNumber(['a', 'b'], n))).toEqual([null, 'a', 'b', undefined, 'b'])
    expect(byNumber([], 9)).toBeUndefined()
    expect([beside(['a', 'b'], 'b', 1), beside(['a', 'b'], null, -1), beside(['a', 'b'], 'a', -1)]).toEqual([null, 'b', null])
  })

  it('keeps what storage held as far as it reads', () => {
    expect(keptFrom(null)).toBeNull()
    expect(keptFrom('not json')).toBeNull()
    expect(keptFrom('{"open":"p1"}')).toBeNull()
    expect(
      keptFrom(
        JSON.stringify({
          open: ['p1', 2],
          places: { p1: { kind: 'thread', threadId: 't' }, p2: { kind: 'bad' }, p3: 'x', p4: { kind: 'thread' } },
        }),
      ),
    ).toEqual({ open: ['p1'], places: { p1: { kind: 'thread', threadId: 't' } } })
    expect(keptFrom(JSON.stringify({ open: [] }))).toEqual({ open: [], places: {} })
    expect(keptFrom(JSON.stringify({ open: [], rooms: { p1: 'board', p2: 'kitchen', p3: 3 } }))).toEqual({
      open: [],
      places: {},
      rooms: { p1: 'board' },
    })
  })
})
