import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectSummary, type Service } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { projectRoute } from '../src/renderer/features/project/route'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { RepositoriesView } from '../src/renderer/features/repositories/RepositoriesView'
import { repositoriesRoute } from '../src/renderer/features/repositories/route'
import { useRepositories } from '../src/renderer/features/repositories/useRepositories'
import { rulesRoute } from '../src/renderer/features/rules/route'
import { useProjectSettings } from '../src/renderer/features/project/useProjectSettings'
import { taskRoute } from '../src/renderer/features/task/route'
import { rootRoute } from '../src/renderer/root'
import { changed, connectionList, fakeClient, fakeHost, project, repositories } from './fixtures'
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
    // Its three repositories, by their hosts' marks.
    const repositoriesModule = panel.getByRole('button', { name: /^Repositories/ })
    expect(repositoriesModule.textContent).toContain('3')
    expect(within(repositoriesModule).getByText('GitHub')).toBeTruthy()
    expect(within(repositoriesModule).getByText('GitLab')).toBeTruthy()
    const rules = panel.getByRole('button', { name: /^Rules/ })
    expect(rules.textContent).toContain('Allow, except what you keep')
    expect(rules.textContent).toContain('Always asks you:')
    await userEvent.click(repositoriesModule)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/repositories'))
    expect(await screen.findByRole('list', { name: 'On this Mac' })).toBeTruthy()
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

/** GitLab offered too, which glab is signed in to here, with nothing of the projects' on it. */
const gitlabToo: Parameters<typeof fakeClient>[0] = {
  listConnections: vi.fn(async () => ({
    ...connectionList,
    products: [
      ...connectionList.products,
      {
        product: 'gitlab' as const,
        service: 'gitlab' as const,
        name: 'GitLab',
        host: true,
        tracker: true,
        hostedUrl: 'https://gitlab.com',
        selfHosted: true,
        browserSignIn: false,
        tokenNeeds: null,
        tokenPrefixes: ['glpat-'],
        tokenHelpForKey: null,
        keyChecks: [],
      },
    ],
  })),
  getConnectGuide: vi.fn(async (service: Service) => ({
    service,
    places: [],
    clis: [{ product: 'gitlab' as const, webUrl: 'https://gitlab.com', tool: 'glab' as const, account: 'you', scopes: ['api'] }],
    email: null,
    tokenPages: [],
  })),
}

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

  it('opens a repository on its host, and walks in to one that isn’t connected, over the page', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient(gitlabToo)
    withServices(<Repositories />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More for meridian-api' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open on GitHub' }))
    expect(opened).toHaveBeenCalledWith('https://github.com/meridian/api', '_blank')
    opened.mockRestore()

    // GitLab's own walk, at its ways: glab's sign-in, or a token.
    const connect = screen.getByRole('button', { name: 'Connect GitLab' })
    await userEvent.click(connect)
    const dialog = within(await screen.findByRole('dialog', { name: 'GitLab' }))
    expect(client.getConnectGuide).toHaveBeenCalledWith('gitlab')
    const ways = await dialog.findByRole('group', { name: 'Ways to connect GitLab' })
    expect(within(ways).getByRole('button', { name: /Use glab’s sign-in/ })).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Done' })).toBeNull()
    // A step in and back, then Escape at its ways closes it.
    await userEvent.click(within(ways).getByRole('button', { name: /Make a token/ }))
    expect(dialog.getByRole('heading', { name: 'Make a token on gitlab.com' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(await dialog.findByRole('group', { name: 'Ways to connect GitLab' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
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
    // And connecting, over the page.
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitLab' }))
    await screen.findByRole('dialog', { name: 'GitLab' })
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
