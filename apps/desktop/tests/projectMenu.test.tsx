import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectSummary } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { projectRoute } from '../src/renderer/features/project/route'
import { RepositoriesView } from '../src/renderer/features/repositories/RepositoriesView'
import { repositoriesRoute } from '../src/renderer/features/repositories/route'
import { useRepositories } from '../src/renderer/features/repositories/useRepositories'
import { rulesRoute } from '../src/renderer/features/rules/route'
import { taskRoute } from '../src/renderer/features/task/route'
import { rootRoute } from '../src/renderer/root'
import { changed, fakeClient, fakeHost, project, repositories } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * A project's menu: renaming it, its repositories, and removing it from
 * Althar, from its bar, through the app's own routes, under its tabs.
 */

beforeEach(() => window.localStorage.clear())

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>The home</p> })

/** The window at a place, with a client whose project list follows what was renamed and removed. */
const windowAt = (path: string, overrides: Parameters<typeof fakeClient>[0] = {}) => {
  let now: ReadonlyArray<ProjectSummary> = [project]
  const fake = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: now })),
    renameProject: vi.fn(async (_projectId: string, name: string) => {
      now = now.map((each) => ({ ...each, name }))
    }),
    removeProject: vi.fn(async () => {
      now = []
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

const openMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'More for this project' }))
  return within(await screen.findByRole('menu', { name: 'This project' }))
}

describe('a project’s menu', () => {
  it('renames the project: its tab and its head take the new name, without a restart', async () => {
    const { client } = windowAt('/projects/p1')
    const menu = await openMenu()
    expect(menu.getByRole('menuitem', { name: /Repositories/ }).textContent).toContain('1')
    await userEvent.click(menu.getByRole('menuitem', { name: 'Rename' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Rename the project' }))
    const field = dialog.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Refunds v2{Enter}')
    await waitFor(() => expect(client.renameProject).toHaveBeenCalledWith('p1', 'Refunds v2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('heading', { name: 'Refunds v2' })).toBeTruthy()
    await waitFor(() => expect(tabNamed('Refunds v2')).toBeTruthy())
  })

  it('says why a rename didn’t happen, and keeps the dialog open', async () => {
    const { client } = windowAt('/projects/p1', {
      renameProject: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: 'Give the project a name.' })
      }),
    })
    await userEvent.click((await openMenu()).getByRole('menuitem', { name: 'Rename' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Rename the project' }))
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), ' 2{Enter}')
    expect(await dialog.findByRole('alert')).toHaveProperty('textContent', 'Give the project a name.')
    expect(client.renameProject).toHaveBeenCalledOnce()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('removes the project after saying what happens, and goes home; its tab goes', async () => {
    const { client, router } = windowAt('/projects/p1')
    await waitFor(() => expect(tabNamed('meridian')).toBeTruthy())
    await userEvent.click((await openMenu()).getByRole('menuitem', { name: 'Remove from Althar' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove meridian from Althar?' }))
    expect(dialog.getByText(/Its task under way stops/)).toBeTruthy()
    expect(dialog.getByText(/stay in ~\/Althar\/meridian/)).toBeTruthy()
    expect(client.removeProject).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove project' }))
    await waitFor(() => expect(client.removeProject).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByText('The home')).toBeTruthy()
    // It was the only one: with no project the window has no tabs, as before the first.
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull())
  })

  it('goes home when another window removes the project', async () => {
    let listed: ReadonlyArray<ProjectSummary> = [project]
    const { emit, router } = windowAt('/threads/th1', { listProjects: vi.fn(async () => ({ cursor: 3, projects: listed })) })
    await screen.findByRole('button', { name: 'More for this project' })
    listed = []
    emit(changed('project', 'p1', null, 'p1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('offers the same from a task’s bar, and opens the project’s repositories and rules', async () => {
    const { router } = windowAt('/threads/th1')
    await userEvent.click((await openMenu()).getByRole('menuitem', { name: /Repositories/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/repositories'))
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeTruthy()
    router.history.push('/threads/th1')
    await userEvent.click((await openMenu()).getByRole('menuitem', { name: 'Project rules' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/rules'))
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
