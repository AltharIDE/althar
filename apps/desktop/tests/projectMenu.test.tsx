import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectSummary } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { projectRoute } from '../src/renderer/features/project/route'
import { useConnections } from '../src/renderer/features/connections/useConnections'
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

  it('goes home when another window removes the project, from one of its tasks too', async () => {
    let listed: ReadonlyArray<ProjectSummary> = [project]
    // From one of its tasks, as from the project.
    const { emit, router } = windowAt('/threads/th1', { listProjects: vi.fn(async () => ({ cursor: 3, projects: listed })) })
    await screen.findByRole('heading', { level: 1, name: 'Add a retry' })
    listed = []
    emit(changed('project', 'p1', null, 'p1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

function Repositories({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <RepositoriesView model={useRepositories('p1')} connections={useConnections()} onBack={onBack} />
}

describe('a project’s repositories', () => {
  it('shows where each one is on this Mac and where its work goes, and keeps each change at once', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient()
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_lib') })
    withServices(<Repositories onBack={onBack} />, client, host)
    const here = within(await screen.findByRole('list', { name: 'On this Mac' }))
    expect(here.getByText('~/code/meridian-api')).toBeTruthy()
    expect(here.getByText('trunk')).toBeTruthy()
    // On GitHub as you, the fork with the repository it forks; GitLab not connected.
    const github = within(screen.getByRole('region', { name: 'GitHub' }))
    expect(github.getByText('Connected as you')).toBeTruthy()
    expect(github.getByText('meridian/api')).toBeTruthy()
    expect(github.getByText('Your fork')).toBeTruthy()
    expect(github.getByText('The repository it forks')).toBeTruthy()
    const gitlab = within(screen.getByRole('region', { name: 'GitLab' }))
    expect(gitlab.getByText('Not connected')).toBeTruthy()
    expect(gitlab.getByText('meridian-ops/infra')).toBeTruthy()
    expect(screen.getByText('Tasks work in their own worktrees, in')).toBeTruthy()

    await userEvent.click(here.getByRole('combobox', { name: 'Role of meridian-api' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Library' }))
    await waitFor(() => expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: 'repo_api', role: 'library' }))

    await userEvent.click(github.getByRole('combobox', { name: 'Where meridian-web’s pull requests open' }))
    await userEvent.click(await screen.findByRole('option', { name: 'meridian/web' }))
    await waitFor(() =>
      expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: 'repo_web', changeTarget: 'upstream' }),
    )

    await userEvent.click(here.getByRole('button', { name: 'More for meridian-web' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Leave out of meridian/ }))
    await waitFor(() => expect(client.leaveOutRepository).toHaveBeenCalledWith('p1', 'repo_web'))

    await userEvent.click(screen.getByRole('button', { name: 'Back to meridian' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows a folder being added while it is read, and adds a dropped one too', async () => {
    let added = (): void => undefined
    const { client } = fakeClient({
      readFolder: vi.fn(async () => ({
        kind: 'repository' as const,
        name: 'meridian-docs',
        repositories: [{ path: '/Users/me/code/meridian-docs', folder: null, name: 'meridian-docs', branch: 'main', remote: null }],
        project: null,
      })),
      addRepositories: vi.fn(() => new Promise<void>((resolve) => (added = resolve))),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_docs') })
    withServices(<Repositories />, client, host)
    await screen.findByRole('list', { name: 'On this Mac' })
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    expect(host.pickFolder).toHaveBeenCalledWith('project')
    expect(await screen.findByText('Reading it. Nothing in it changes')).toBeTruthy()
    expect(screen.getByText('~/code/meridian-docs')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a folder' }).getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(client.addRepositories).toHaveBeenCalledWith('p1', 'grant_docs'))
    added()
    await waitFor(() => expect(screen.queryByText('Reading it. Nothing in it changes')).toBeNull())

    // Dropped on the page, each folder is granted and added the same way.
    const page = screen.getByRole('heading', { level: 1, name: 'Repositories' }).closest('header')?.parentElement ?? document.body
    const folder = new File([], 'meridian-docs')
    const dataTransfer = { types: ['Files'], files: [folder] }
    fireEvent.dragEnter(page, { dataTransfer })
    fireEvent.drop(page, { dataTransfer })
    await waitFor(() => expect(host.grantDropped).toHaveBeenCalledWith(folder))
    await waitFor(() => expect(client.addRepositories).toHaveBeenLastCalledWith('p1', 'grant_dropped'))
    added()
  })

  it('opens a repository on its host, and connects one that isn’t, over the page', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient()
    withServices(<Repositories />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More for meridian-api' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open on GitHub' }))
    expect(opened).toHaveBeenCalledWith('https://github.com/meridian/api', '_blank')
    opened.mockRestore()

    const connect = screen.getByRole('button', { name: 'Connect GitLab' })
    await userEvent.click(connect)
    const dialog = within(await screen.findByRole('dialog', { name: 'Code hosts and trackers' }))
    expect(await dialog.findByRole('list', { name: 'Code hosts' })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Focus comes back to where it was.
    await waitFor(() => expect(document.activeElement).toBe(connect))
  })

  it('adds folders dropped while one is being added after it, and stays busy until the last', async () => {
    const pending: Array<() => void> = []
    const { client } = fakeClient({
      readFolder: vi.fn(async (grant: string) => ({
        kind: 'repository' as const,
        name: grant,
        repositories: [{ path: `/Users/me/code/${grant}`, folder: null, name: grant, branch: 'main', remote: null }],
        project: null,
      })),
      addRepositories: vi.fn(() => new Promise<void>((resolve) => pending.push(resolve))),
    })
    const grantDropped = vi.fn(async (file: File) => file.name)
    withServices(<Repositories />, client, fakeHost({ grantDropped }))
    await screen.findByRole('list', { name: 'On this Mac' })
    const page = screen.getByRole('heading', { level: 1, name: 'Repositories' }).closest('header')?.parentElement ?? document.body
    const drop = (name: string) => {
      const dataTransfer = { types: ['Files'], files: [new File([], name)] }
      fireEvent.dragEnter(page, { dataTransfer })
      fireEvent.drop(page, { dataTransfer })
    }
    drop('meridian-docs')
    expect(await screen.findByText('~/code/meridian-docs')).toBeTruthy()
    drop('meridian-sdk')
    await waitFor(() => expect(grantDropped).toHaveBeenCalledTimes(2))
    // The second waits for the first.
    expect(client.addRepositories).toHaveBeenCalledOnce()
    pending[0]?.()
    expect(await screen.findByText('~/code/meridian-sdk')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('~/code/meridian-docs')).toBeNull())
    expect(screen.getByRole('button', { name: 'Add a folder' }).getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(client.addRepositories).toHaveBeenLastCalledWith('p1', 'meridian-sdk'))
    pending[1]?.()
    await waitFor(() => expect(screen.queryByText('Reading it. Nothing in it changes')).toBeNull())
    expect(screen.getByRole('button', { name: 'Add a folder' }).getAttribute('aria-busy')).toBeNull()
  })

  it('goes back on Escape, but not while something else has it', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient()
    withServices(<Repositories onBack={onBack} />, client)
    const here = within(await screen.findByRole('list', { name: 'On this Mac' }))
    // Escape closes a choice first.
    await userEvent.click(here.getByRole('combobox', { name: 'Role of meridian-api' }))
    await screen.findByRole('option', { name: 'Library' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Library' })).toBeNull())
    expect(onBack).not.toHaveBeenCalled()
    // And the connections, over the page.
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitLab' }))
    await screen.findByRole('dialog', { name: 'Code hosts and trackers' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onBack).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('reads them again when a code host is connected, as the window hears it', async () => {
    const { client, emit } = fakeClient()
    withServices(<Repositories />, client)
    await screen.findByRole('list', { name: 'On this Mac' })
    expect(client.getRepositories).toHaveBeenCalledOnce()
    emit(changed('connection', 'c1', null, null))
    await waitFor(() => expect(client.getRepositories).toHaveBeenCalledTimes(2))
  })

  it('says what went wrong, and puts a change the runtime refused back', async () => {
    const { client } = fakeClient({
      setRepository: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: "That repository isn't a fork, so its pull requests open on it." })
      }),
      getRepositories: vi.fn(async () => repositories.slice(0, 1)),
      readFolder: vi.fn(async () => {
        throw new ApiError({ reason: 'NotARepository', message: 'There’s no git repository in Downloads.' })
      }),
    })
    // The first thing dropped isn't a folder here; the next is Downloads, with no repository in it.
    const grantDropped = vi
      .fn<(file: File) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('grant_downloads')
    const host = fakeHost({ pickFolder: vi.fn(async () => null), grantDropped })
    withServices(<Repositories />, client, host)
    const here = within(await screen.findByRole('list', { name: 'On this Mac' }))
    // The last one has no way to be left out: its menu only opens it on GitHub.
    await userEvent.click(here.getByRole('button', { name: 'More for meridian-api' }))
    expect(screen.queryByRole('menuitem', { name: /Leave out/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(here.getByRole('combobox', { name: 'Role of meridian-api' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Docs' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "That repository isn't a fork, so its pull requests open on it.")
    await waitFor(() => expect(here.getByRole('combobox', { name: 'Role of meridian-api' }).textContent).toContain('Service'))
    // Cancelling the picker adds nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    expect(client.addRepositories).not.toHaveBeenCalled()
    // Something dropped that isn't a folder here says so; a folder with no repository, too.
    const page = screen.getByRole('heading', { level: 1, name: 'Repositories' }).closest('header')?.parentElement ?? document.body
    const dataTransfer = { types: ['Files'], files: [new File([], 'notes.txt')] }
    fireEvent.dragEnter(page, { dataTransfer })
    fireEvent.drop(page, { dataTransfer })
    expect(await screen.findByText('notes.txt isn’t a folder on this Mac.')).toBeTruthy()
    fireEvent.dragEnter(page, { dataTransfer })
    fireEvent.drop(page, { dataTransfer })
    expect(await screen.findByText('There’s no git repository in Downloads.')).toBeTruthy()
    expect(client.addRepositories).not.toHaveBeenCalled()
  })

  it('says so when they can’t be read, with the way back', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({
      getRepositories: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })
      }),
    })
    withServices(<Repositories onBack={onBack} />, client)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "That project isn't there any more.")
    await userEvent.click(screen.getByRole('button', { name: 'Back to meridian' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
