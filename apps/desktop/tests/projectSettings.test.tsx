import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectSummary } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { projectRoute } from '../src/renderer/features/project/route'
import { RepositoriesView } from '../src/renderer/features/repositories/RepositoriesView'
import { repositoriesRoute } from '../src/renderer/features/repositories/route'
import { useRepositories } from '../src/renderer/features/repositories/useRepositories'
import { rulesRoute } from '../src/renderer/features/rules/route'
import { useProjectSettings } from '../src/renderer/features/project/useProjectSettings'
import { taskRoute } from '../src/renderer/features/task/route'
import { rootRoute } from '../src/renderer/root'
import { changed, fakeClient, fakeHost, project, repositories } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * A project's settings, from the Settings button on its front page: its
 * name and colour changed in place, its repositories and its rules opened,
 * connecting its code host, and removing it from Althar, through the app's
 * own routes, under its tabs.
 */

beforeEach(() => window.localStorage.clear())

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>The home</p> })

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'Halyard', slug: 'halyard', ink: 'clay' }

/** The window at a place, with a client whose project list follows what was renamed, inked and removed. */
const windowAt = (path: string, overrides: Parameters<typeof fakeClient>[0] = {}) => {
  let now: ReadonlyArray<ProjectSummary> = [project, halyard]
  const fake = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: now })),
    renameProject: vi.fn(async (projectId: string, name: string) => {
      now = now.map((each) => (each.id === projectId ? { ...each, name } : each))
    }),
    setProjectInk: vi.fn(async (projectId: string, ink: ProjectSummary['ink']) => {
      now = now.map((each) => (each.id === projectId ? { ...each, ink } : each))
    }),
    removeProject: vi.fn(async (projectId: string) => {
      now = now.filter((each) => each.id !== projectId)
    }),
    ...overrides,
  })
  const services = servicesFor(fake.client)
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, repositoriesRoute, rulesRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { client: fake.client, cache: services.cache },
  })
  render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )
  return { ...fake, router }
}

/** A project's tab, by its name, in the window's tabs. */
const tabNamed = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Projects' })).queryByRole('button', { name: new RegExp(`^${name}`) })

/** The project's settings, opened from its front page. */
const openSettings = async (project = 'meridian') => {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return within(await screen.findByRole('dialog', { name: `${project}’s settings` }))
}

/** Its name and colour, opened out in its settings. */
const openIdentity = async () => {
  const panel = await openSettings()
  await userEvent.click(panel.getByRole('button', { name: /^Name and colour/ }))
  return panel
}

/** The ink the front page's wash is drawn in. */
const washOf = (name: string) => screen.getByRole('heading', { level: 1, name }).closest('header')?.getAttribute('style')

describe('a project’s settings', () => {
  it('renames the project in place: its front page and its tab take the new name, without a restart', async () => {
    const { client } = windowAt('/projects/p1')
    const panel = await openIdentity()
    const field = panel.getByRole('textbox', { name: 'Name' })
    await userEvent.type(field, ' v2{Enter}')
    // It shows at once, before the runtime has said so.
    expect(screen.getByRole('heading', { level: 1, name: 'meridian v2' })).toBeTruthy()
    await waitFor(() => expect(client.renameProject).toHaveBeenCalledWith('p1', 'meridian v2'))
    await waitFor(() => expect(tabNamed('meridian v2')).toBeTruthy())
    expect(field).toHaveProperty('value', 'meridian v2')
    // Back to all of them, the module says the new name.
    await userEvent.click(panel.getByRole('button', { name: 'Back to all settings' }))
    expect(panel.getByRole('button', { name: /^Name and colour/ }).textContent).toContain('meridian v2')
  })

  it('draws the project in another ink, at once and everywhere; another project’s ink says whose it is', async () => {
    const { client } = windowAt('/projects/p1')
    await screen.findByRole('heading', { level: 1, name: 'meridian' })
    expect(washOf('meridian')).toContain('--project-teal')
    const panel = await openIdentity()
    expect(panel.getByRole('radio', { name: 'Teal' })).toHaveProperty('ariaChecked', 'true')
    expect(panel.getByRole('radio', { name: 'Clay, Halyard’s' })).toBeTruthy()
    await userEvent.click(panel.getByRole('radio', { name: 'Rose' }))
    expect(washOf('meridian')).toContain('--project-rose')
    await waitFor(() => expect(client.setProjectInk).toHaveBeenCalledWith('p1', 'rose'))
    // The projects are read again, so the tabs and the home draw it in its new ink too.
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
    expect(washOf('meridian')).toContain('--project-rose')
  })

  it('puts the name back and says why when a rename doesn’t hold', async () => {
    const { client } = windowAt('/projects/p1', {
      renameProject: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: 'Give the project a name.' })
      }),
    })
    const panel = await openIdentity()
    await userEvent.type(panel.getByRole('textbox', { name: 'Name' }), ' 2{Enter}')
    expect(await panel.findByRole('alert')).toHaveProperty('textContent', 'Give the project a name.')
    expect(client.renameProject).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { level: 1, name: 'meridian' })).toBeTruthy()
    expect(panel.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'meridian')
  })

  it('says where each thing stands, and opens its repositories and its rules', async () => {
    const { router } = windowAt('/projects/p1')
    let panel = await openSettings()
    const repositoriesModule = panel.getByRole('button', { name: /^Repositories/ })
    expect(repositoriesModule.textContent).toContain('2')
    expect(within(repositoriesModule).getByText('GitHub')).toBeTruthy()
    const rules = panel.getByRole('button', { name: /^Rules/ })
    expect(rules.textContent).toContain('Allow, except what you keep')
    expect(rules.textContent).toContain('Always asks you:')
    await userEvent.click(repositoriesModule)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/repositories'))
    expect(await screen.findByRole('list', { name: 'Repositories' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back to meridian' }))
    panel = await openSettings()
    await userEvent.click(panel.getByRole('button', { name: /^Rules/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/rules'))
  })

  it('removes the project after saying what happens, and goes home; its tab goes', async () => {
    const { client, router } = windowAt('/projects/p1')
    await waitFor(() => expect(tabNamed('meridian')).toBeTruthy())
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Remove from Althar' }))
    // The settings close as the question opens.
    expect(screen.queryByRole('dialog', { name: 'meridian’s settings' })).toBeNull()
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove meridian from Althar?' }))
    expect(dialog.getByText(/Its task under way stops/)).toBeTruthy()
    expect(dialog.getByText(/stay in ~\/Althar\/meridian/)).toBeTruthy()
    expect(client.removeProject).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove project' }))
    await waitFor(() => expect(client.removeProject).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByText('The home')).toBeTruthy()
    await waitFor(() => expect(tabNamed('meridian')).toBeNull())
  })

  it('says why a removal didn’t happen, and keeps the question open', async () => {
    windowAt('/projects/p1', {
      removeProject: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })
      }),
    })
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Remove from Althar' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove meridian from Althar?' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Remove project' }))
    expect(await dialog.findByRole('alert')).toHaveProperty('textContent', "That project isn't there any more.")
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('goes home when another window removes the project, from one of its tasks too', async () => {
    let listed: ReadonlyArray<ProjectSummary> = [project]
    // From one of its tasks, as from the project.
    const { emit, router } = windowAt('/threads/th1', { listProjects: vi.fn(async () => ({ cursor: 3, projects: listed })) })
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    listed = []
    emit(changed('project', 'p1', null, 'p1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

/** The settings' view model on its own, with the window's services. */
const settingsOf = (client: Parameters<typeof servicesFor>[0]) => {
  const services = servicesFor(client)
  return renderHook(() => useProjectSettings('p1', vi.fn()), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('a project’s name and colour, as they are kept', () => {
  it('shows the last choice until its own change is done, whatever was chosen before it', async () => {
    const waiting: Array<() => void> = []
    const { client } = fakeClient({ setProjectInk: vi.fn(() => new Promise<void>((resolve) => waiting.push(resolve))) })
    const { result } = settingsOf(client)
    await waitFor(() => expect(result.current.ink).toBe('teal'))
    act(() => {
      result.current.setInk('rose')
      result.current.setInk('slate')
      result.current.setInk('rose')
    })
    expect(result.current.ink).toBe('rose')
    // One after another: the first rose done, then slate, the last rose still shows.
    await waitFor(() => expect(waiting).toHaveLength(1))
    act(() => waiting[0]?.())
    await waitFor(() => expect(waiting).toHaveLength(2))
    expect(result.current.ink).toBe('rose')
    act(() => waiting[1]?.())
    await waitFor(() => expect(waiting).toHaveLength(3))
    expect(result.current.ink).toBe('rose')
    expect(client.setProjectInk).toHaveBeenNthCalledWith(3, 'p1', 'rose')
    // Done, it is the runtime's to say.
    act(() => waiting[2]?.())
    await waitFor(() => expect(result.current.ink).toBe('teal'))
  })

  it('says why a change didn’t hold until a later one does', async () => {
    let calls = 0
    const { client } = fakeClient({
      setProjectInk: vi.fn(async () => {
        calls += 1
        if (calls === 1) throw new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })
      }),
    })
    const { result } = settingsOf(client)
    await waitFor(() => expect(result.current.ink).toBe('teal'))
    act(() => result.current.setInk('rose'))
    await waitFor(() => expect(result.current.failed).toBe("That project isn't there any more."))
    expect(result.current.ink).toBe('teal')
    // Another made while the first was failing: once it holds, nothing is said of the first.
    act(() => {
      result.current.setInk('rose')
      result.current.setInk('slate')
    })
    await waitFor(() => expect(client.setProjectInk).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(result.current.failed).toBeNull())
  })
})

function Repositories({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <RepositoriesView model={useRepositories('p1')} onBack={onBack} />
}

describe('a project’s repositories', () => {
  it('lists them as this Mac has them, and keeps each change at once', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient()
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_lib') })
    withServices(<Repositories onBack={onBack} />, client, host)
    const list = within(await screen.findByRole('list', { name: 'Repositories' }))
    expect(list.getByText('~/code/meridian-api')).toBeTruthy()
    expect(list.getByText('Its remote is a fork of meridian/web.')).toBeTruthy()
    expect(list.getByText('A task under way changes it, and keeps it if it is left out.')).toBeTruthy()

    await userEvent.click(list.getByRole('combobox', { name: 'Role of meridian-api' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Library' }))
    await waitFor(() => expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: 'repo_api', role: 'library' }))

    await userEvent.click(list.getByRole('combobox', { name: 'Where tasks open pull requests' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Pull requests on meridian/web' }))
    await waitFor(() =>
      expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: 'repo_web', changeTarget: 'upstream' }),
    )

    await userEvent.click(list.getByRole('button', { name: 'Leave out meridian-web' }))
    await waitFor(() => expect(client.leaveOutRepository).toHaveBeenCalledWith('p1', 'repo_web'))

    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    await waitFor(() => expect(client.addRepositories).toHaveBeenCalledWith('p1', 'grant_lib'))
    expect(host.pickFolder).toHaveBeenCalledWith('project')

    await userEvent.click(screen.getByRole('button', { name: 'Back to meridian' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('says what went wrong, and puts a change the runtime refused back', async () => {
    const { client } = fakeClient({
      setRepository: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: "That repository isn't a fork, so its pull requests open on it." })
      }),
      leaveOutRepository: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: 'The project needs a repository for its tasks to work in.' })
      }),
      getRepositories: vi.fn(async () => repositories.slice(0, 1)),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => null) })
    withServices(<Repositories />, client, host)
    const list = within(await screen.findByRole('list', { name: 'Repositories' }))
    // The last one has no way to be left out.
    expect(list.queryByRole('button', { name: /Leave out/ })).toBeNull()
    await userEvent.click(list.getByRole('combobox', { name: 'Role of meridian-api' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Docs' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "That repository isn't a fork, so its pull requests open on it.")
    await waitFor(() => expect(list.getByRole('combobox', { name: 'Role of meridian-api' }).textContent).toContain('Service'))
    // Cancelling the picker adds nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    expect(client.addRepositories).not.toHaveBeenCalled()
  })

  it('says so when they can’t be read', async () => {
    const { client } = fakeClient({
      getRepositories: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })
      }),
    })
    withServices(<Repositories />, client)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "That project isn't there any more.")
  })
})
