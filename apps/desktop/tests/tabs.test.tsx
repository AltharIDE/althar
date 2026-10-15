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

import { draftsOf } from '../src/renderer/features/newProject/draft'
import { TabsFrame, useLastRoom, useNewTab, useVisit } from '../src/renderer/features/tabs/TabsFrame'
import { glanceOf, memoryOf } from '../src/renderer/features/tabs/useLoad'
import { brandOf } from '../src/renderer/shared/agents'
import { afterClosing, beside, byNumber, firstOpen, keptFrom, whereOf } from '../src/renderer/features/tabs/tabs'
import type { Host } from '../src/renderer/data/services'
import { changed, fakeClient, fakeHost, load, project } from './fixtures'
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
/* A new project's screen: made, under the id it was drawn with, or closed. */
function NewScreen({ projectId }: { projectId: () => string }) {
  const tab = useNewTab()
  return (
    <>
      <Where />
      <button type="button" onClick={() => tab.made(projectId())}>
        Made
      </button>
      <button type="button" onClick={tab.close}>
        Escape
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
let making = () => ''
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: '/new', component: () => <NewScreen projectId={() => making()} /> })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/$section', component: Where })

const windowAt = (path: string, projects: ReadonlyArray<ProjectSummary> = [project, halyard, tessera], host: Host = fakeHost()) => {
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, rulesRoute, threadRoute, newRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { client, emit } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 3, projects })) })
  making = () => draftsOf(client).get()?.id ?? ''
  withServices(<RouterProvider router={router} />, client, host)
  const go = (to: string) => act(() => router.history.push(to))
  return { client, emit, go, router, host }
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

  it('start a new project in a tab of its own, named as it is typed, and closed with nothing made', async () => {
    const { client } = windowAt('/projects/p1', [project])
    const drafts = draftsOf(client)
    // No other project to open: the + is New project itself.
    await waitFor(() => expect(names()).toEqual(['Home', 'meridian, work running']))
    await userEvent.click(nav().getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(where()).toBe('/new'))
    const id = drafts.get()?.id ?? ''
    expect(id).toMatch(/^proj_[0-9a-f]{32}$/)
    expect(names()).toEqual(['Home', 'meridian, work running', 'New project'])
    expect(nav().getAllByRole('listitem').at(-1)?.querySelector('[aria-current="page"]')).not.toBeNull()
    act(() => drafts.change(id, (now) => ({ ...now, name: '  Northwind ' })))
    expect(names()).toEqual(['Home', 'meridian, work running', 'Northwind'])

    // Away and back, it is the same; ⌘N goes to it rather than starting another.
    await userEvent.click(tab('meridian'))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(tab('Northwind').getAttribute('aria-current')).toBeNull()
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    await waitFor(() => expect(where()).toBe('/new'))
    expect(drafts.get()?.id).toBe(id)
    expect(tab('Northwind').getAttribute('aria-current')).toBe('page')

    // Closed, nothing is made, and the tab before it has the window.
    await userEvent.click(nav().getByRole('button', { name: 'Close Northwind' }))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(drafts.get()).toBeNull()
    expect(names()).toEqual(['Home', 'meridian, work running'])

    // Closed from another tab, it goes at once; Escape on its page goes back as closing it does.
    await userEvent.click(nav().getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(where()).toBe('/new'))
    await userEvent.click(tab('meridian'))
    await userEvent.click(nav().getByRole('button', { name: 'Close New project' }))
    expect(drafts.get()).toBeNull()
    await userEvent.click(nav().getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(where()).toBe('/new'))
    await userEvent.click(screen.getByRole('button', { name: 'Escape' }))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(drafts.get()).toBeNull()
  })

  it('make the new project’s tab the project’s own, open on its conversation', async () => {
    const { client, emit, router } = windowAt('/', [project, halyard, tessera])
    const drafts = draftsOf(client)
    // With other projects to open, New project is the + menu's last.
    await userEvent.click(await screen.findByRole('button', { name: 'Open a project' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /New project/ }))
    await waitFor(() => expect(where()).toBe('/new'))
    const id = drafts.get()?.id ?? ''
    act(() => drafts.change(id, (now) => ({ ...now, name: 'Northwind', ink: 'umber' })))
    const northwind: ProjectSummary = { ...halyard, id, name: 'Northwind', slug: 'northwind', ink: 'umber' }
    vi.mocked(client.listProjects).mockResolvedValue({ cursor: 4, projects: [project, halyard, tessera, northwind] })
    emit(changed('project', id))
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Made' }))
    await waitFor(() => expect(where()).toBe(`/projects/${id}`))
    expect(router.state.location.search).toEqual({ room: Room.Talk })
    expect(drafts.get()).toBeNull()
    expect(names()).toEqual(['Home, 2 calls wait on you', 'meridian, work running', 'tessera, 2 calls wait on you', 'Northwind'])
    expect(tab('Northwind').getAttribute('aria-current')).toBe('page')
  })

  it('say in the bar that a newer Althar is ready, with Restart only while no work runs', async () => {
    let tell: (glance: unknown) => void = () => undefined
    const restart = vi.fn(async () => true)
    const host = fakeHost({
      update: {
        glance: vi.fn(async () => ({ ready: '0.1.1', working: true, restarting: false, failed: null })),
        restart,
        onChange: (listener) => {
          tell = listener
          return () => undefined
        },
      },
    })
    windowAt('/', [project], host)
    const line = (await screen.findByText('Althar 0.1.1 is ready')).parentElement
    if (line === null) throw new Error('The line has no parent')
    expect(within(line).getByText('Installs when you quit')).toBeTruthy()
    expect(within(line).queryByRole('button')).toBeNull()

    act(() => tell({ ready: '0.1.1', working: false, restarting: false, failed: null }))
    await userEvent.click(within(line).getByRole('button', { name: 'Restart' }))
    expect(restart).toHaveBeenCalledOnce()
    act(() => tell({ ready: '0.1.1', working: false, restarting: true, failed: null }))
    expect(within(line).getByText('Restarting…')).toBeTruthy()
    // Nothing ready, nothing said.
    act(() => tell({ ready: null, working: false, restarting: false, failed: null }))
    expect(screen.queryByText(/is ready/)).toBeNull()
  })
})

describe('Althar’s settings, in the window', () => {
  const gear = () => screen.getByRole('button', { name: /^Althar settings/ })
  const quick = () => screen.findByRole('dialog', { name: 'Quick settings' })
  const noQuick = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick settings' })).toBeNull())
  const comma = (shiftKey = false) => fireEvent.keyDown(window, { key: shiftKey ? '<' : ',', code: 'Comma', metaKey: true, shiftKey })
  const kept = () => keptFrom(window.localStorage.getItem('althar.tabs'))

  it('open their quick settings on every screen, and a tab of their own beside the home’s, kept on its section', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: ['p1', 'p2'], places: {} }))
    windowAt('/projects/p2')
    await waitFor(() => expect(tab('halyard').getAttribute('aria-current')).toBe('page'))
    // No tab for them until they are open.
    expect(nav().queryByRole('button', { name: /^Settings/ })).toBeNull()

    // From a project's screen, the gear's quick settings; All settings goes to their tab, at its first section.
    await userEvent.click(gear())
    await userEvent.click(within(await quick()).getByRole('button', { name: /^All settings/ }))
    await waitFor(() => expect(where()).toBe('/settings/agents'))
    await noQuick()
    expect(names().map((name) => name.split(',')[0])).toEqual(['Home', 'Settings', 'meridian', 'halyard'])
    expect(tab('Settings').getAttribute('aria-current')).toBe('page')
    expect(tab('halyard').getAttribute('aria-current')).toBeNull()

    // ⌘, on their own tab too; a card's name goes to the section it is in.
    comma()
    await userEvent.click(within(await quick()).getByRole('button', { name: /^Keep awake/ }))
    await waitFor(() => expect(where()).toBe('/settings/this-mac'))

    // To a project and back: the tab is where it was.
    await userEvent.click(tab('meridian'))
    expect(where()).toBe('/projects/p1')
    expect(tab('Settings').getAttribute('aria-current')).toBeNull()
    await userEvent.click(tab('Settings'))
    expect(where()).toBe('/settings/this-mac')
    // ⌘⇧, from anywhere goes there too.
    await userEvent.click(tab('Home'))
    comma(true)
    await waitFor(() => expect(where()).toBe('/settings/this-mac'))
    // Control-Tab steps through it too, between the home's and the projects'.
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(where()).toBe('/settings/this-mac'))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(where()).toBe('/'))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() => expect(where()).toBe('/settings/this-mac'))
    // Kept for the next launch, with its section.
    expect(kept()).toMatchObject({ open: ['p1', 'p2'], settings: 'this-mac' })

    // ⌘, opens and closes the quick settings.
    comma()
    expect(await quick()).toBeTruthy()
    comma()
    await noQuick()

    // Closed: the tab after it has the window, and its section is forgotten.
    await userEvent.click(nav().getByRole('button', { name: 'Close Settings' }))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(nav().queryByRole('button', { name: /^Settings/ })).toBeNull()
    expect(kept()?.settings).toBeUndefined()
  })

  it('open again on the section they were on, after a launch, and close to the home where there is no project tab', async () => {
    window.localStorage.setItem('althar.tabs', JSON.stringify({ open: [], places: {}, settings: 'reviews' }))
    windowAt('/', [halyard])
    await userEvent.click(await waitFor(() => tab('Settings')))
    expect(where()).toBe('/settings/reviews')
    await userEvent.click(nav().getByRole('button', { name: 'Close Settings' }))
    await waitFor(() => expect(where()).toBe('/'))
  })

  it('wait for the bar, which comes with the first project', async () => {
    windowAt('/', [])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: /^Althar settings/ })).toBeNull()
    comma()
    comma(true)
    expect(screen.queryByRole('dialog', { name: 'Quick settings' })).toBeNull()
    expect(where()).toBe('/')
  })
})

describe('how hard the Mac works, in the bar', () => {
  const meter = () => screen.findByRole('button', { name: 'CPU 42%, MEM 39%' })
  const peek = async () => {
    await userEvent.click(await meter())
    return within(await screen.findByRole('dialog', { name: 'This Mac’s load' }))
  }

  it('shows on every screen, and a piece of work’s row opens it: a task’s thread, its project’s conversation, its front', async () => {
    const { client, router } = windowAt('/projects/p2')
    await userEvent.click((await peek()).getByRole('button', { name: /^Add a retry/ }))
    await waitFor(() => expect(where()).toBe('/threads/th1'))
    expect(client.getLoad).toHaveBeenCalled()

    await userEvent.click((await peek()).getByRole('button', { name: /^Coordinator\s*meridian · Codex · 1 process/ }))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(router.state.location.search).toEqual({ room: Room.Talk })

    await act(() => router.navigate({ to: '/projects/$projectId', params: { projectId: 'p2' } }))
    await userEvent.click((await peek()).getByRole('button', { name: /^Default branch\s*meridian · 3 processes/ }))
    await waitFor(() => expect(where()).toBe('/projects/p1'))
    expect(router.state.location.search).toEqual({})
  })

  it('goes from the bar when turned off in its peek, and isn’t read again', async () => {
    const host = fakeHost()
    const { client } = windowAt('/', [project], host)
    await userEvent.click((await peek()).getByRole('switch', { name: 'Show in the bar' }))
    expect(host.setPreference).toHaveBeenCalledWith('showLoad', false)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^CPU/ })).toBeNull())
    const reads = vi.mocked(client.getLoad).mock.calls.length
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(client.getLoad).toHaveBeenCalledTimes(reads)
  })

  it('isn’t read before there is a project, when the first screen has the window and no bar', async () => {
    const { client } = windowAt('/', [])
    await waitFor(() => expect(client.listProjects).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(client.getLoad).not.toHaveBeenCalled()
  })

  it('is never read while it is off', async () => {
    const host = fakeHost()
    await host.setPreference('showLoad', false)
    const { client } = windowAt('/', [project], host)
    await screen.findByRole('navigation', { name: 'Projects' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(client.getLoad).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^CPU/ })).toBeNull()
  })

  it('draws the runtime’s reading: memory as macOS counts it, Althar’s part of each, and its work by name', () => {
    expect([memoryOf(32 * 1024 ** 3), memoryOf(19.54 * 1024 ** 3), memoryOf(300 * 1024 ** 2), memoryOf(10)]).toEqual([
      '32 GB',
      '19.5 GB',
      '300 MB',
      '1 MB',
    ])
    const glance = glanceOf(load)
    expect(glance).toMatchObject({ cpu: 0.42, memory: 12.5 / 32, memoryUsed: '12.5 GB', memoryTotal: '32 GB', pressure: 'normal' })
    expect(glance.work).toBeCloseTo(0.33)
    expect(glance.workMemory).toBeCloseTo((1.5 * 1024 + 520) / (32 * 1024))
    expect(glance.rows?.map((row) => [row.id, row.title, row.agent, row.mark, row.memory])).toEqual([
      ['task t1', 'Add a retry', 'Claude Code', brandOf('claude-code'), '1.5 GB'],
      ['coordinator p1', 'Coordinator', 'Codex', brandOf('codex'), '300 MB'],
      ['run p1', 'Default branch', undefined, undefined, '220 MB'],
    ])
    // Where Althar's processes can't be read, its part is unknown, not none; and a computer that says no memory has none in use.
    const unknown = glanceOf({ ...load, shares: null, pressure: null, memoryTotal: 0 })
    expect(unknown).toMatchObject({ work: null, workMemory: null, rows: null, pressure: null, memory: 0 })
    expect(glanceOf({ ...load, pressure: 'critical' }).pressure).toBe('critical')
    expect(glanceOf({ ...load, pressure: 'warning' }).pressure).toBe('warning')
  })
})

describe('the window’s own buttons in the strip', () => {
  it('draws them off a Mac, and asks the main process for what they say', async () => {
    const host = fakeHost({ platform: 'linux' })
    windowAt('/', [project], host)
    await waitFor(() => expect(tab('Home')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Minimize the window' }))
    expect(host.window).toHaveBeenCalledWith('minimize')
    await userEvent.click(screen.getByRole('button', { name: 'Maximize the window' }))
    expect(host.window).toHaveBeenCalledWith('toggle-maximize')
    await userEvent.click(screen.getByRole('button', { name: 'Close the window' }))
    expect(host.window).toHaveBeenCalledWith('close')
  })

  it('leaves them to the system on macOS', async () => {
    windowAt('/')
    await waitFor(() => expect(tab('Home')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Close the window' })).toBeNull()
  })
})

describe('working out the tabs', () => {
  it('reads where the window is from its address', () => {
    expect(whereOf('/')).toEqual({ kind: 'home' })
    expect(whereOf('/settings')).toEqual({ kind: 'home' })
    expect(whereOf('/new')).toEqual({ kind: 'new' })
    expect(whereOf('/projects/p%201')).toEqual({ kind: 'project', projectId: 'p 1', place: { kind: 'project' } })
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

  it('reads the settings’ tab from its address, a section it doesn’t have as their first, and keeps one it knows', () => {
    expect(whereOf('/settings/this-mac')).toEqual({ kind: 'settings', section: 'this-mac' })
    expect(whereOf('/settings/mac')).toEqual({ kind: 'settings', section: 'agents' })
    expect(keptFrom(JSON.stringify({ open: [], settings: 'notifications' }))).toEqual({ open: [], places: {}, settings: 'notifications' })
    expect(keptFrom(JSON.stringify({ open: [], settings: 'mac' }))).toEqual({ open: [], places: {} })
  })
})
