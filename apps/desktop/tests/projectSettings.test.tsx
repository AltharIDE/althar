import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardTask, type ConnectionSummary, type ProjectSummary, type ProjectTracker, type Service } from '@althar/contracts'

import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { projectRoute } from '../src/renderer/features/project/route'
import { useProjectSettings } from '../src/renderer/features/projectSettings/useProjectSettings'
import { taskRoute } from '../src/renderer/features/task/route'
import { rootRoute } from '../src/renderer/root'
import {
  card,
  changed,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  githubConnection,
  project,
  repositories,
  runnables,
} from './fixtures'
import { servicesFor } from './render'

/*
 * A project's settings, a view of the project from Settings in the window's
 * bar, under its front page, through the app's own routes and tabs: its name
 * and colour changed in place, the switches every task follows, its
 * repositories and the trackers its tasks' issues are on, its rules, what it
 * runs, the notes its coordinator keeps, and removing it from Althar.
 */

beforeEach(() => window.localStorage.clear())

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>The home</p> })
const appSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: () => <p>Althar’s settings</p>,
})

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'Halyard', slug: 'halyard', ink: 'clay' }

/** The window at a place, with a client whose project list follows what was renamed, inked and removed. */
const windowAt = (path: string, overrides: Parameters<typeof fakeClient>[0] = {}, host: Host = fakeHost()) => {
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
  const services = servicesFor(fake.client, host)
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, taskRoute, appSettingsRoute]),
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

/** The project's views, in the window's bar. */
const views = async () => within(await screen.findByRole('radiogroup', { name: 'View' }))

/** The project's settings, opened from the bar, at a section where one is named. */
const openSettings = async (section?: string) => {
  await userEvent.click((await views()).getByRole('radio', { name: /^Settings/ }))
  const side = within(await screen.findByRole('navigation', { name: 'Project settings' }))
  if (section !== undefined) await userEvent.click(side.getByRole('button', { name: new RegExp(`^${section}`) }))
  return side
}

/** The section open: its sheet, by its title. */
const sheet = (title: string) => within(screen.getByRole('region', { name: title }))

/** What a control's description says: a switch's note, under its name. */
const descriptionOf = (control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')

/** The ink the front page's wash is drawn in. */
/** The ink of the project's mark in its header, beside its name. */
const inkOf = (name: string) =>
  screen.getByRole('heading', { level: 1, name }).closest('header')?.querySelector('[data-ink]')?.getAttribute('data-ink')

/** A task on the board, from an issue on Linear, read through a connection where it names one. */
const taskFrom = (key: string, connectionId?: string): BoardTask => ({
  ...card(),
  taskId: `t_${key}`,
  threadId: `th_${key}`,
  state: 'done',
  phase: 'settled',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: '2026-10-01T09:00:00.000Z',
  changed: null,
  here: [],
  issue: {
    product: 'linear',
    key,
    title: key,
    url: `https://linear.app/northwind/issue/${key}/refunds`,
    ...(connectionId === undefined ? {} : { connectionId }),
  },
})

/** The board with tasks from MER issues on Linear, which Althar is connected to as these say. */
const onLinear = (...connections: ReadonlyArray<ConnectionSummary>): Parameters<typeof fakeClient>[0] => ({
  getBoard: vi.fn(async () => ({ cursor: 1, tasks: [taskFrom('MER-12'), taskFrom('MER-14')], calls: [], settledTotal: 2 })),
  listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, ...connections] })),
})

const linear = (state: ConnectionSummary['state'], id = 'conn_linear', login = 'balazs'): ConnectionSummary => ({
  id,
  product: 'linear',
  name: 'Linear',
  webUrl: 'https://linear.app',
  account: { login, name: 'Balázs' },
  auth: 'token',
  state,
})

describe('a project’s settings', () => {
  it('open in place of its work, under its front page, on General, with every section down the side', async () => {
    windowAt('/projects/p1')
    const side = await openSettings()
    expect(screen.getByRole('heading', { level: 1, name: 'meridian' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeTruthy()
    expect(side.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'General',
      'Code and issues',
      'Rules',
      'Running',
      'Notes',
      'Remove from Althar…',
    ])
    expect(side.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    // Back to its work, the conversation is where it was.
    await userEvent.click((await views()).getByRole('radio', { name: 'Conversation' }))
    expect(screen.queryByRole('navigation', { name: 'Project settings' })).toBeNull()
  })

  it('open at a section an address names, as a task’s way to its rules does', async () => {
    windowAt('/projects/p1?room=settings&section=rules')
    expect(await screen.findByRole('heading', { level: 2, name: 'Rules' })).toBeTruthy()
    expect((await views()).getByRole('radio', { name: 'Settings' })).toHaveProperty('ariaChecked', 'true')
    // The rules are named by the section: only their key is above the sentences.
    expect(await screen.findByRole('heading', { level: 3, name: 'Always' })).toBeTruthy()
  })

  it('renames the project in place: its front page and its tab take the new name, without a restart', async () => {
    const { client } = windowAt('/projects/p1')
    await openSettings()
    const field = sheet('General').getByRole('textbox', { name: 'Name' })
    await userEvent.type(field, ' v2{Enter}')
    // It shows at once, before the runtime has said so.
    expect(screen.getByRole('heading', { level: 1, name: 'meridian v2' })).toBeTruthy()
    await waitFor(() => expect(client.renameProject).toHaveBeenCalledWith('p1', 'meridian v2'))
    await waitFor(() => expect(tabNamed('meridian v2')).toBeTruthy())
    expect(field).toHaveProperty('value', 'meridian v2')
  })

  it('draws the project in another ink, at once and everywhere; another project’s ink says whose it is', async () => {
    const { client } = windowAt('/projects/p1')
    await screen.findByRole('heading', { level: 1, name: 'meridian' })
    expect(inkOf('meridian')).toBe('teal')
    await openSettings()
    const general = sheet('General')
    expect(general.getByRole('radio', { name: 'Teal' })).toHaveProperty('ariaChecked', 'true')
    expect(general.getByRole('radio', { name: 'Clay, Halyard’s' })).toBeTruthy()
    await userEvent.click(general.getByRole('radio', { name: 'Rose' }))
    expect(inkOf('meridian')).toBe('rose')
    await waitFor(() => expect(client.setProjectInk).toHaveBeenCalledWith('p1', 'rose'))
    // The projects are read again, so the tabs and the home draw it in its new ink too.
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
    expect(inkOf('meridian')).toBe('rose')
  })

  it('puts the name back and says why when a rename doesn’t hold', async () => {
    const { client } = windowAt('/projects/p1', {
      renameProject: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: 'Give the project a name.' })
      }),
    })
    await openSettings()
    const general = sheet('General')
    await userEvent.type(general.getByRole('textbox', { name: 'Name' }), ' 2{Enter}')
    expect(await general.findByRole('alert')).toHaveProperty('textContent', 'Give the project a name.')
    expect(client.renameProject).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { level: 1, name: 'meridian' })).toBeTruthy()
    expect(general.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'meridian')
  })

  it('says when each switch acts, and has its leads resolve conflicts unasked once turned on', async () => {
    const { client } = windowAt('/projects/p1')
    await openSettings()
    const tasks = within(screen.getByRole('region', { name: 'Tasks' }))
    const conflicts = tasks.getByRole('switch', { name: 'Resolve merge conflicts automatically' })
    expect(conflicts.getAttribute('aria-checked')).toBe('false')
    expect(descriptionOf(conflicts)).toBe('When a task’s branch stops merging cleanly, its lead fixes it and runs the checks again.')
    await userEvent.click(conflicts)
    // On at once, and kept as a revision of the rules, with nothing else in it.
    expect(conflicts.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', resolveConflicts: true }))
    // On, every open task can be looked at now, rather than as each default branch moves.
    await userEvent.click(tasks.getByRole('button', { name: 'Look for conflicts now' }))
    expect(client.lookForConflicts).toHaveBeenCalledWith('p1')
    expect(descriptionOf(conflicts)).toContain('Looking at each open task now.')
    await userEvent.click(conflicts)
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', resolveConflicts: false }))
    expect(conflicts.getAttribute('aria-checked')).toBe('false')
  })

  it('moves a task’s issue to In Progress as it starts, on every tracker that has one, unless switched off', async () => {
    const { client } = windowAt('/projects/p1')
    await openSettings()
    const move = within(screen.getByRole('region', { name: 'Tasks' })).getByRole('switch', {
      name: 'Move issues along with their tasks',
    })
    expect(move.getAttribute('aria-checked')).toBe('true')
    expect(descriptionOf(move)).toBe(
      'To In Progress when a task starts from an issue; to In Review and Done as its pull request opens and merges.',
    )
    await userEvent.click(move)
    // Off at once, before the runtime has said so.
    expect(move.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', moveIssues: false }))
    expect(move.getAttribute('aria-checked')).toBe('false')
  })

  it('pushes the lead’s commits by itself unless switched off', async () => {
    const { client } = windowAt('/projects/p1')
    await openSettings()
    const push = within(screen.getByRole('region', { name: 'Tasks' })).getByRole('switch', {
      name: 'Push the lead’s commits automatically',
    })
    expect(push.getAttribute('aria-checked')).toBe('true')
    expect(descriptionOf(push)).toBe(
      'When a lead’s turn ends, what it committed goes up to its pull request, even after you’ve looked. If someone else pushed there, it waits for you.',
    )
    await userEvent.click(push)
    expect(push.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', pushCommits: false }))
  })

  it('lets changes to issues apply without a card once switched on, off until then', async () => {
    const { client } = windowAt('/projects/p1')
    await openSettings()
    const change = within(screen.getByRole('region', { name: 'Tasks' })).getByRole('switch', { name: 'Change issues without asking' })
    expect(change.getAttribute('aria-checked')).toBe('false')
    expect(descriptionOf(change)).toBe(
      'Status, priority, assignee, labels and closing apply at once, instead of waiting for you on a card.',
    )
    await userEvent.click(change)
    expect(change.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', changeIssues: true }))
  })

  it('switches back, saying why under the one that didn’t hold, and the other says nothing of it', async () => {
    windowAt('/projects/p1', {
      setProjectRules: vi.fn(async () => {
        throw new ApiError({ reason: 'RulesChanged', message: 'The rules changed meanwhile.' })
      }),
    })
    await openSettings()
    const tasks = within(screen.getByRole('region', { name: 'Tasks' }))
    const move = tasks.getByRole('switch', { name: 'Move issues along with their tasks' })
    await userEvent.click(move)
    expect(await tasks.findByRole('alert')).toHaveProperty('textContent', 'The rules changed meanwhile.')
    await waitFor(() => expect(move.getAttribute('aria-checked')).toBe('true'))
    expect(descriptionOf(move)).toMatch(/The rules changed meanwhile\.$/)
    expect(descriptionOf(tasks.getByRole('switch', { name: 'Resolve merge conflicts automatically' }))).not.toMatch(/changed meanwhile/)
  })

  it('shows the notes its coordinator keeps, newest first, who kept each, and drops one that no longer holds', async () => {
    const notes = [
      {
        id: 'note_1',
        body: 'Issue drafts need an approval card, on every tracker.',
        createdAt: '2026-10-01T09:00:00.000Z',
        keptBy: 'coordinator' as const,
      },
      {
        id: 'note_2',
        body: 'Dependency setup runs outside the sandbox.',
        createdAt: '2026-10-02T09:00:00.000Z',
        keptBy: 'person' as const,
      },
    ]
    let kept = notes
    const { client } = windowAt('/projects/p1', {
      getProjectNotes: vi.fn(async () => kept),
      dropProjectNote: vi.fn(async (_projectId: string, noteId: string) => {
        kept = kept.filter((note) => note.id !== noteId)
      }),
    })
    await openSettings('Notes')
    const cards = await sheet('Notes').findAllByRole('listitem')
    expect(cards.map((one) => one.textContent)).toEqual([
      expect.stringMatching(/^Dependency setup runs outside the sandbox\.Kept by you · /),
      expect.stringMatching(/^Issue drafts need an approval card, on every tracker\.Kept by the coordinator · /),
    ])
    await userEvent.click(sheet('Notes').getByRole('button', { name: 'Remove “Dependency setup runs outside the sandbox.”' }))
    await waitFor(() => expect(client.dropProjectNote).toHaveBeenCalledWith('p1', 'note_2'))
    await waitFor(() => expect(sheet('Notes').getAllByRole('listitem')).toHaveLength(1))
    expect(sheet('Notes').getByRole('button', { name: /^Remove “Issue drafts/ })).toBe(document.activeElement)
  })

  it('says a note in the person’s words where it is, on one line, and puts it back, saying why, where that doesn’t hold', async () => {
    let kept = [
      { id: 'note_1', body: 'Issue drafts need an approval card.', createdAt: '2026-10-01T09:00:00.000Z', keptBy: 'coordinator' as const },
    ]
    const { client } = windowAt('/projects/p1', {
      getProjectNotes: vi.fn(async () => kept),
      editProjectNote: vi.fn(async (_projectId: string, noteId: string, body: string) => {
        if (body.includes('Jira'))
          throw new ApiError({ reason: 'NoteRefused', message: 'A note is a sentence or two: at most 300 characters.' })
        kept = kept.map((note) => (note.id === noteId ? { ...note, body } : note))
      }),
    })
    await openSettings('Notes')
    await userEvent.click(await sheet('Notes').findByRole('button', { name: 'Edit “Issue drafts need an approval card.”' }))
    const field = sheet('Notes').getByRole('textbox', { name: 'Note' })
    expect(field).toBe(document.activeElement)
    await userEvent.type(field, '{Backspace}, on Linear   only.{Enter}')
    await waitFor(() =>
      expect(client.editProjectNote).toHaveBeenCalledWith('p1', 'note_1', 'Issue drafts need an approval card, on Linear only.'),
    )
    expect(await sheet('Notes').findByText('Issue drafts need an approval card, on Linear only.')).toBeTruthy()
    expect(sheet('Notes').getByRole('button', { name: /^Edit “Issue drafts/ })).toBe(document.activeElement)
    // One that doesn’t hold goes back as it was, saying why.
    await userEvent.keyboard('{Enter}')
    await userEvent.type(sheet('Notes').getByRole('textbox', { name: 'Note' }), ' And Jira.{Enter}')
    expect(await sheet('Notes').findByRole('alert')).toHaveProperty('textContent', 'A note is a sentence or two: at most 300 characters.')
    expect(await sheet('Notes').findByText('Issue drafts need an approval card, on Linear only.')).toBeTruthy()
  })

  it('puts a note back and says why when dropping it doesn’t hold', async () => {
    const note = {
      id: 'note_1',
      body: 'Issue drafts need an approval card.',
      createdAt: '2026-10-01T09:00:00.000Z',
      keptBy: 'coordinator' as const,
    }
    windowAt('/projects/p1', {
      getProjectNotes: vi.fn(async () => [note]),
      dropProjectNote: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: 'That project isn’t there any more.' })
      }),
    })
    await openSettings('Notes')
    await userEvent.click(await sheet('Notes').findByRole('button', { name: 'Remove “Issue drafts need an approval card.”' }))
    expect(await sheet('Notes').findByRole('alert')).toHaveProperty('textContent', 'That project isn’t there any more.')
    await waitFor(() => expect(sheet('Notes').getAllByRole('listitem')).toHaveLength(1))
  })

  it('removes the project from the foot of the side, after saying what happens, and goes home; its tab goes', async () => {
    const { client, router } = windowAt('/projects/p1')
    await waitFor(() => expect(tabNamed('meridian')).toBeTruthy())
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Remove from Althar…' }))
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
    await userEvent.click((await openSettings()).getByRole('button', { name: 'Remove from Althar…' }))
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

describe('a project’s trackers, in its settings', () => {
  it('says in violet that Althar isn’t connected to the tracker its tasks use, with a dot on Settings, and connects it over the page', async () => {
    windowAt('/projects/p1', onLinear())
    expect((await views()).getByRole('radio', { name: 'Settings, needs you' })).toBeTruthy()
    const side = await openSettings()
    await userEvent.click(side.getByRole('button', { name: 'Code and issues, needs you' }))
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('MER issues · Linear')).toBeTruthy()
    expect(trackers.getByText('Not connected')).toBeTruthy()
    await userEvent.click(trackers.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('dialog', { name: 'Linear' })).toBeTruthy()
  })

  it('says to sign in again where the sign-in stopped working', async () => {
    windowAt('/projects/p1', onLinear(linear('reauth_required')))
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Signed out as balazs')).toBeTruthy()
    expect(trackers.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
  })

  it('says to sign in again to the account its issues go through, though another is signed in there', async () => {
    // Work's sign-in stopped working; a personal account is signed in on the same Linear.
    const work = linear('reauth_required', 'conn_work', 'balazs-work')
    const personal = linear('ready', 'conn_personal', 'balazs')
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({
        cursor: 1,
        tasks: [taskFrom('MER-12', 'conn_work'), taskFrom('MER-14', 'conn_work')],
        calls: [],
        settledTotal: 2,
      })),
      listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, personal, work] })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings, needs you' })).toBeTruthy()
    const side = await openSettings()
    await userEvent.click(side.getByRole('button', { name: 'Code and issues, needs you' }))
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Signed out as balazs-work')).toBeTruthy()
    expect(trackers.queryByText('Connected as balazs')).toBeNull()
    // Signing in again opens that account's own sign-in, named for Linear, not the list of every connection.
    await userEvent.click(trackers.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByRole('dialog', { name: 'Linear' })).toBeTruthy()
  })

  it('says who Althar is there by the account its issues go through, though another there is signed out', async () => {
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [taskFrom('MER-12', 'conn_personal')], calls: [], settledTotal: 1 })),
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [githubConnection, linear('reauth_required', 'conn_work', 'balazs-work'), linear('ready', 'conn_personal', 'balazs')],
      })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings' })).toBeTruthy()
    await openSettings('Code and issues')
    expect(within(screen.getByRole('region', { name: 'Trackers' })).getByText('Connected as balazs')).toBeTruthy()
  })

  it('says one key that reaches several teams of a workspace is connected for each team its issues are on', async () => {
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({
        cursor: 1,
        tasks: [taskFrom('DEV-74', 'conn_key'), taskFrom('OPS-3', 'conn_key')],
        calls: [],
        settledTotal: 2,
      })),
      listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, linear('ready', 'conn_key', 'mate')] })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings' })).toBeTruthy()
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getAllByText('Connected as mate')).toHaveLength(2)
    expect(trackers.queryByText('Not connected')).toBeNull()
  })

  it('says a tracker isn’t connected once the account its issues go through is removed, though another is signed in there', async () => {
    // Work's account was removed, so listing connections leaves it out; a personal one is signed in on the same Linear.
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [taskFrom('MER-12', 'conn_work')], calls: [], settledTotal: 1 })),
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [githubConnection, linear('ready', 'conn_personal', 'balazs')],
      })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings, needs you' })).toBeTruthy()
    const side = await openSettings()
    await userEvent.click(side.getByRole('button', { name: 'Code and issues, needs you' }))
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Not connected')).toBeTruthy()
    expect(trackers.queryByText('Connected as balazs')).toBeNull()
  })

  it('says a tracker isn’t connected once one of the accounts its issues go through is removed, though the other is signed in', async () => {
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({
        cursor: 1,
        tasks: [taskFrom('MER-12', 'conn_personal'), taskFrom('MER-14', 'conn_personal'), taskFrom('MER-15', 'conn_work')],
        calls: [],
        settledTotal: 3,
      })),
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [githubConnection, linear('ready', 'conn_personal', 'balazs')],
      })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings, needs you' })).toBeTruthy()
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Not connected')).toBeTruthy()
    expect(trackers.queryByText('Connected as balazs')).toBeNull()
  })

  it('names a tracker whose issues share no key by its name: a project’s Trello cards', async () => {
    const trello = {
      ...connectionList.products[1]!,
      product: 'trello',
      service: 'trello',
      name: 'Trello',
      hostedUrl: 'https://trello.com',
      tokenPrefixes: [],
    } as const
    const card = (key: string): BoardTask => ({
      ...taskFrom(key),
      issue: {
        product: 'trello',
        key,
        title: 'Refund keys',
        url: `https://trello.com/c/${key}/12-refund-keys`,
        connectionId: 'conn_trello',
      },
    })
    windowAt('/projects/p1', {
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [card('aBcD1234'), card('xYz98765')], calls: [], settledTotal: 2 })),
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: [...connectionList.products, trello],
        connections: [githubConnection],
      })),
    })
    expect((await views()).getByRole('radio', { name: 'Settings, needs you' })).toBeTruthy()
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Trello cards')).toBeTruthy()
    expect(trackers.getByText('Not connected')).toBeTruthy()
    expect(trackers.queryByText('No tracker yet')).toBeNull()
  })

  it('says who Althar is there once connected, with no dot, and opens the team on Linear', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    windowAt('/projects/p1', onLinear(linear('ready')))
    expect((await views()).getByRole('radio', { name: 'Settings' })).toBeTruthy()
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('Connected as balazs')).toBeTruthy()
    await userEvent.click(trackers.getByRole('button', { name: 'Open on Linear' }))
    expect(opened).toHaveBeenCalledWith('https://linear.app/northwind/team/MER', '_blank')
    opened.mockRestore()
  })

  it('sends its issues to one of two Linear workspaces, and a team there, once the person binds it (ADR-059)', async () => {
    const althar = { ...linear('ready', 'conn_althar', 'mate'), workspace: { key: 'althar', name: 'althar' } }
    const fnt = { ...linear('ready', 'conn_fnt', 'mate'), workspace: { key: 'fnt', name: 'FNT' } }
    let bound: ProjectTracker | null = null
    const { client } = windowAt('/projects/p1', {
      ...onLinear(althar, fnt),
      getProjectTracker: vi.fn(async () => bound),
      setProjectTracker: vi.fn(async (_projectId: string, next: ProjectTracker | null) => {
        bound = next
      }),
      listContainers: vi.fn(async (connectionId: string) =>
        connectionId === 'conn_fnt' ? [{ id: 'team-f', key: 'FNT', name: 'Fintech' }] : [],
      ),
    })
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    // Unset, where its issues already are, as before.
    const goTo = await trackers.findByRole('combobox', { name: 'Issues go to' })
    expect(goTo.textContent).toContain('Where its issues are')
    expect(trackers.queryByRole('combobox', { name: 'Team' })).toBeNull()

    await userEvent.click(goTo)
    await userEvent.click(await screen.findByRole('option', { name: 'Linear · FNT' }))
    expect(client.setProjectTracker).toHaveBeenCalledWith('p1', { connectionId: 'conn_fnt', container: null })
    const team = await trackers.findByRole('combobox', { name: 'Team' })
    await waitFor(() => expect(team.hasAttribute('disabled')).toBe(false))
    await userEvent.click(team)
    await userEvent.click(await screen.findByRole('option', { name: 'FNT (Fintech)' }))
    expect(client.setProjectTracker).toHaveBeenLastCalledWith('p1', {
      connectionId: 'conn_fnt',
      container: { id: 'team-f', name: 'Fintech' },
    })
    await waitFor(() => expect(team.textContent).toContain('FNT (Fintech)'))

    // Unbound again, it goes back to where its issues are.
    await userEvent.click(goTo)
    await userEvent.click(await screen.findByRole('option', { name: 'Where its issues are' }))
    expect(client.setProjectTracker).toHaveBeenLastCalledWith('p1', null)
  })

  it('says the workspace it is bound to was disconnected, rather than going back to where its issues are', async () => {
    const althar = { ...linear('ready', 'conn_althar', 'mate'), workspace: { key: 'althar', name: 'althar' } }
    const listContainers = vi.fn(async () => [])
    windowAt('/projects/p1', {
      ...onLinear(althar),
      getProjectTracker: vi.fn(async (): Promise<ProjectTracker> => ({
        connectionId: 'conn_fnt',
        container: { id: 'team-f', name: 'Fintech' },
        gone: { product: 'linear', webUrl: 'https://linear.app', workspace: 'FNT' },
      })),
      listContainers,
    })
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    const goTo = await trackers.findByRole('combobox', { name: 'Issues go to' })
    await waitFor(() => expect(goTo.textContent).toContain('Linear · FNT (disconnected)'))
    expect(trackers.getByText(/^Disconnected\./)).toBeTruthy()
    expect(trackers.queryByRole('combobox', { name: 'Team' })).toBeNull()
    expect(listContainers).not.toHaveBeenCalled()
  })

  it('says why a binding didn’t hold, and puts it back', async () => {
    const fnt = { ...linear('ready', 'conn_fnt', 'mate'), workspace: { key: 'fnt', name: 'FNT' } }
    windowAt('/projects/p1', {
      ...onLinear(fnt),
      setProjectTracker: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: 'That connection is gone.' })
      }),
    })
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    const goTo = await trackers.findByRole('combobox', { name: 'Issues go to' })
    await userEvent.click(goTo)
    await userEvent.click(await screen.findByRole('option', { name: 'Linear · FNT' }))
    expect(await trackers.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect(goTo.textContent).toContain('Where its issues are'))
  })

  describe('with a tracker bound', () => {
    const fnt = { ...linear('ready', 'conn_fnt', 'mate'), workspace: { key: 'fnt', name: 'Blushh' } }
    const signedOut: ConnectionSummary = { ...fnt, state: 'reauth_required' }
    const binding: ProjectTracker = { connectionId: 'conn_fnt', container: { id: 'team-f', name: 'Blushh Core' } }
    const withBoard = (tasks: ReadonlyArray<BoardTask>, connection: ConnectionSummary, bound: ProjectTracker | null) => ({
      getBoard: vi.fn(async () => ({ cursor: 1, tasks, calls: [], settledTotal: tasks.length })),
      listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, connection] })),
      getProjectTracker: vi.fn(async () => bound),
      listContainers: vi.fn(async () => [{ id: 'team-f', key: 'FNT', name: 'Blushh Core' }]),
    })

    it('bound by hand with no issue yet, never says there is no tracker, and shows who it is connected as and a link', async () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null)
      windowAt('/projects/p1', withBoard([], fnt, binding))
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('Connected as mate')).toBeTruthy()
      expect(trackers.queryByText('No tracker yet')).toBeNull()
      expect(trackers.queryByRole('button', { name: 'Connect a tracker' })).toBeNull()
      expect(trackers.getByRole('button', { name: 'Connect another' })).toBeTruthy()
      await userEvent.click(trackers.getByRole('button', { name: 'Open on Linear' }))
      expect(opened).toHaveBeenCalledWith('https://linear.app/fnt', '_blank')
      opened.mockRestore()
    })

    it('shows the bound tracker in the project’s header, opening its workspace', async () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null)
      windowAt('/projects/p1', withBoard([], fnt, binding))
      await userEvent.click(await screen.findByRole('button', { name: 'Made of' }))
      const made = await screen.findByRole('menu', { name: 'Made of' })
      await userEvent.click(within(made).getByRole('menuitem', { name: 'Linear issues' }))
      expect(opened).toHaveBeenCalledWith('https://linear.app/fnt', '_blank')
      opened.mockRestore()
    })

    it('asks to sign in again where the bound connection is not ready', async () => {
      windowAt('/projects/p1', withBoard([], signedOut, binding))
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('Signed out as mate')).toBeTruthy()
      expect(trackers.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
      // Its page is still there to open beside it.
      expect(trackers.getByRole('button', { name: 'Open on Linear' })).toBeTruthy()
      expect(trackers.queryByText('No tracker yet')).toBeNull()
    })

    it('bound to a workspace alone, with two teams learned, takes neither for the bound one and does not say drafts go to either', async () => {
      windowAt(
        '/projects/p1',
        withBoard([taskFrom('MER-12', 'conn_fnt'), taskFrom('FNT-3', 'conn_fnt')], fnt, { connectionId: 'conn_fnt', container: null }),
      )
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('MER issues · Linear')).toBeTruthy()
      expect(trackers.getByText('FNT issues · Linear')).toBeTruthy()
      expect(trackers.getByText('Linear issues')).toBeTruthy()
      expect(trackers.queryByText(/drafts go to/)).toBeNull()
      expect(trackers.getAllByText(/the bound workspace is above/)).toHaveLength(2)
    })

    it('bound to a signed-out workspace whose team cannot be read, keeps the sign-in prompt and does not take another team for the bound one', async () => {
      windowAt('/projects/p1', {
        ...withBoard([taskFrom('MER-12', 'conn_fnt')], signedOut, binding),
        listContainers: vi.fn(async () => {
          throw new Error('signed out')
        }),
      })
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect((await trackers.findAllByText('Signed out as mate')).length).toBeGreaterThan(0)
      expect(trackers.getAllByRole('button', { name: 'Sign in again' }).length).toBeGreaterThan(0)
      expect(trackers.getByText('MER issues · Linear')).toBeTruthy()
      expect(trackers.getByText('Linear issues')).toBeTruthy()
      expect(trackers.getAllByText(/Its drafts go to the tracker above/)).toHaveLength(1)
    })

    it('bound through a ready account of a workspace where another account is signed out, says it is connected', async () => {
      const other = { ...fnt, id: 'conn_other', state: 'reauth_required' as const, account: { login: 'sam', name: 'Sam' } }
      windowAt('/projects/p1', {
        ...withBoard([taskFrom('FNT-12', 'conn_other'), taskFrom('FNT-13', 'conn_fnt')], fnt, binding),
        listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, fnt, other] })),
      })
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('Connected as mate')).toBeTruthy()
      expect(trackers.queryByRole('button', { name: 'Sign in again' })).toBeNull()
      expect(trackers.getAllByText(/issues · Linear/)).toHaveLength(1)
    })

    it('learned and not bound, lists it as before, with Connect a tracker', async () => {
      windowAt('/projects/p1', withBoard([taskFrom('MER-12', 'conn_fnt')], fnt, null))
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('MER issues · Linear')).toBeTruthy()
      expect(trackers.getByRole('button', { name: 'Connect a tracker' })).toBeTruthy()
      expect(trackers.queryByText(/drafts go to/)).toBeNull()
    })

    it('learned and bound to the same team, lists it once', async () => {
      windowAt('/projects/p1', withBoard([taskFrom('FNT-12', 'conn_fnt')], fnt, binding))
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('FNT issues · Linear')).toBeTruthy()
      expect(trackers.getAllByText(/issues · Linear/)).toHaveLength(1)
      expect(trackers.queryByText(/drafts go to/)).toBeNull()
      expect(trackers.queryByText('No tracker yet')).toBeNull()
    })

    it('learned on another team of the bound workspace, lists both, the bound first, and says drafts go to the bound one', async () => {
      windowAt('/projects/p1', withBoard([taskFrom('MER-12', 'conn_fnt')], fnt, binding))
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('MER issues · Linear')).toBeTruthy()
      expect(trackers.getByText('Linear issues')).toBeTruthy()
      expect(trackers.getAllByText(/Its drafts go to the tracker above/)).toHaveLength(1)
    })

    it('bound to a workspace that needs signing in, keeps that sign-in prompt where another workspace has an issue with no connection', async () => {
      const other = { ...linear('ready', 'conn_other', 'sam'), workspace: { key: 'other', name: 'other' } }
      windowAt('/projects/p1', {
        ...withBoard([taskFrom('MER-12')], signedOut, binding),
        listConnections: vi.fn(async () => ({
          ...connectionList,
          connections: [githubConnection, signedOut, other],
        })),
      })
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('Signed out as mate')).toBeTruthy()
      expect(trackers.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
      expect(trackers.getByText('MER issues · Linear')).toBeTruthy()
    })

    it('learned on one workspace and bound to another, lists both and says where drafts do not go', async () => {
      const althar = { ...linear('ready', 'conn_althar', 'mate'), workspace: { key: 'althar', name: 'althar' } }
      windowAt('/projects/p1', {
        ...withBoard([taskFrom('MER-12', 'conn_althar')], fnt, binding),
        listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, fnt, althar] })),
      })
      await openSettings('Code and issues')
      const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
      expect(await trackers.findByText('MER issues · Linear')).toBeTruthy()
      expect(trackers.getByText('Linear issues')).toBeTruthy()
      expect(trackers.getAllByText(/Its drafts go to the tracker above/)).toHaveLength(1)
    })
  })

  it('says none has been named yet, offers to connect one, and leads to Althar’s own connections', async () => {
    const { router } = windowAt('/projects/p1')
    await openSettings('Code and issues')
    const trackers = within(screen.getByRole('region', { name: 'Trackers' }))
    expect(trackers.getByText('No tracker yet')).toBeTruthy()
    await userEvent.click(trackers.getByRole('button', { name: 'Connect a tracker' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Manage connections' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/code-hosts'))
  })
})

describe('what a project runs, in its settings', () => {
  const running = { getCoordinator: vi.fn(async () => coordinatorSnapshot({ runnables })) }

  it('lists what it runs in its order, the default first, and puts them in another order in place', async () => {
    const { client } = windowAt('/projects/p1', running)
    await openSettings('Running')
    const list = within(screen.getByRole('region', { name: 'What it runs' }))
    expect(list.getAllByRole('listitem').map((one) => one.textContent)).toEqual([
      expect.stringMatching(/^bun run dev.*Default$/),
      expect.stringMatching(/^Storybook/),
    ])
    list.getByRole('button', { name: 'Drag to move bun run dev' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(client.orderRunnables).toHaveBeenCalledWith('p1', ['rnbl_storybook', 'rnbl_dev']))
  })

  it('adds and changes one in the dialogs Run has, and comes back to the page', async () => {
    windowAt('/projects/p1', running)
    await openSettings('Running')
    const list = within(screen.getByRole('region', { name: 'What it runs' }))
    await userEvent.click(list.getByRole('button', { name: 'Add something to run' }))
    const add = await screen.findByRole('dialog', { name: 'Add something to run' })
    await userEvent.click(within(add).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(list.getByRole('button', { name: 'Edit Storybook' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit Storybook' })
    await userEvent.click(within(edit).getByRole('button', { name: 'Cancel' }))
    // Not to Run's list: the list is on the page.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('says where its tasks’ work goes, and leads to the rules to change how', async () => {
    windowAt('/projects/p1', running)
    await openSettings('Running')
    const where = within(screen.getByRole('region', { name: 'Where its work goes' }))
    expect(where.getByText('~/Althar/meridian')).toBeTruthy()
    expect(where.getByText('Open a draft pull request. Checks run on it; you mark it ready.')).toBeTruthy()
    await userEvent.click(where.getAllByRole('button', { name: 'Change in Rules' })[0]!)
    expect(await screen.findByRole('heading', { level: 2, name: 'Rules' })).toBeTruthy()
  })

  it('says a task stays on its branch while its host isn’t connected, as the runtime does, and leads to connecting it', async () => {
    const unconnected = repositories.map((repository) =>
      repository.host === null ? repository : { ...repository, host: { ...repository.host, account: null } },
    )
    windowAt('/projects/p1', { ...running, getRepositories: vi.fn(async () => unconnected) })
    await openSettings('Running')
    const where = within(screen.getByRole('region', { name: 'Where its work goes' }))
    expect(
      await where.findByText(
        'Leave it on its branch. Nothing goes to GitHub until Althar is connected there. Then it opens a draft pull request.',
      ),
    ).toBeTruthy()
    expect(where.queryByText(/^Open a draft pull request/)).toBeNull()
    await userEvent.click(where.getByRole('button', { name: 'Connect GitHub' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Code and issues' })).toBeTruthy()
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

/** Its repositories, in Code and issues: where they are, which takes a folder dropped on it. */
const openRepositories = async () => {
  await openSettings('Code and issues')
  const region = await screen.findByRole('region', { name: 'Repositories' })
  return { region, here: within(await within(region).findByRole('list', { name: 'On this Mac' })) }
}

/** Folders dropped on the repositories. */
const dropOn = (region: HTMLElement, ...files: ReadonlyArray<File>) => {
  const dataTransfer = { types: ['Files'], files }
  fireEvent.dragEnter(region, { dataTransfer })
  fireEvent.drop(region, { dataTransfer })
}

describe('a project’s repositories, in its settings', () => {
  it('shows where each one is on this Mac and where its work goes, and keeps each change at once', async () => {
    const { client } = windowAt('/projects/p1')
    const { here } = await openRepositories()
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
    // A code host never connected is the person's choice: Settings has no dot for it.
    expect((await views()).getByRole('radio', { name: 'Settings' })).toBeTruthy()

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
  })

  it('shows a folder being added while it is read, and adds a dropped one too', async () => {
    let added = (): void => undefined
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_docs') })
    const { client } = windowAt(
      '/projects/p1',
      {
        readFolder: vi.fn(async () => ({
          kind: 'repository' as const,
          name: 'meridian-docs',
          repositories: [{ path: '/Users/me/code/meridian-docs', folder: null, name: 'meridian-docs', branch: 'main', remote: null }],
          project: null,
        })),
        addRepositories: vi.fn(() => new Promise<void>((resolve) => (added = resolve))),
      },
      host,
    )
    const { region } = await openRepositories()
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    expect(host.pickFolder).toHaveBeenCalledWith('project')
    expect(await screen.findByText('Reading it. Nothing in it changes')).toBeTruthy()
    expect(screen.getByText('~/code/meridian-docs')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a folder' }).getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(client.addRepositories).toHaveBeenCalledWith('p1', 'grant_docs'))
    added()
    await waitFor(() => expect(screen.queryByText('Reading it. Nothing in it changes')).toBeNull())

    // Dropped on them, each folder is granted and added the same way.
    const folder = new File([], 'meridian-docs')
    dropOn(region, folder)
    await waitFor(() => expect(host.grantDropped).toHaveBeenCalledWith(folder))
    await waitFor(() => expect(client.addRepositories).toHaveBeenLastCalledWith('p1', 'grant_dropped'))
    added()
  })

  it('opens a repository on its host, and walks in to one that isn’t connected, over the page', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = windowAt('/projects/p1', gitlabToo)
    const { here } = await openRepositories()
    await userEvent.click(here.getByRole('button', { name: 'More for meridian-api' }))
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
    const grantDropped = vi.fn(async (file: File) => file.name)
    const { client } = windowAt(
      '/projects/p1',
      {
        readFolder: vi.fn(async (grant: string) => ({
          kind: 'repository' as const,
          name: grant,
          repositories: [{ path: `/Users/me/code/${grant}`, folder: null, name: grant, branch: 'main', remote: null }],
          project: null,
        })),
        addRepositories: vi.fn(() => new Promise<void>((resolve) => pending.push(resolve))),
      },
      fakeHost({ grantDropped }),
    )
    const { region } = await openRepositories()
    dropOn(region, new File([], 'meridian-docs'))
    expect(await screen.findByText('~/code/meridian-docs')).toBeTruthy()
    dropOn(region, new File([], 'meridian-sdk'))
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

  it('reads them again when a code host is connected, as the window hears it', async () => {
    const { client, emit } = windowAt('/projects/p1')
    await openRepositories()
    const before = vi.mocked(client.getRepositories).mock.calls.length
    emit(changed('connection', 'c1', null, null))
    await waitFor(() => expect(vi.mocked(client.getRepositories).mock.calls.length).toBeGreaterThan(before))
  })

  it('says what went wrong, and puts a change the runtime refused back', async () => {
    // The first thing dropped isn't a folder here; the next is Downloads, with no repository in it.
    const grantDropped = vi
      .fn<(file: File) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('grant_downloads')
    const { client } = windowAt(
      '/projects/p1',
      {
        setRepository: vi.fn(async () => {
          throw new ApiError({ reason: 'ProjectRefused', message: "That repository isn't a fork, so its pull requests open on it." })
        }),
        getRepositories: vi.fn(async () => repositories.slice(0, 1)),
        readFolder: vi.fn(async () => {
          throw new ApiError({ reason: 'NotARepository', message: 'There’s no git repository in Downloads.' })
        }),
      },
      fakeHost({ pickFolder: vi.fn(async () => null), grantDropped }),
    )
    const { region, here } = await openRepositories()
    // The last one has no way to be left out: its menu only opens it on GitHub.
    await userEvent.click(here.getByRole('button', { name: 'More for meridian-api' }))
    expect(screen.queryByRole('menuitem', { name: /Leave out/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(here.getByRole('combobox', { name: 'Role of meridian-api' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Docs' }))
    expect(await within(region).findByRole('alert')).toHaveProperty(
      'textContent',
      "That repository isn't a fork, so its pull requests open on it.",
    )
    await waitFor(() => expect(here.getByRole('combobox', { name: 'Role of meridian-api' }).textContent).toContain('Service'))
    // Cancelling the picker adds nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder' }))
    expect(client.addRepositories).not.toHaveBeenCalled()
    // Something dropped that isn't a folder here says so; a folder with no repository, too.
    dropOn(region, new File([], 'notes.txt'))
    expect(await screen.findByText('notes.txt isn’t a folder on this Mac.')).toBeTruthy()
    dropOn(region, new File([], 'notes.txt'))
    expect(await screen.findByText('There’s no git repository in Downloads.')).toBeTruthy()
    expect(client.addRepositories).not.toHaveBeenCalled()
  })

  it('says so when they can’t be read', async () => {
    windowAt('/projects/p1', {
      getRepositories: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })
      }),
    })
    await openSettings('Code and issues')
    expect(await sheet('Code and issues').findByRole('alert')).toHaveProperty('textContent', "That project isn't there any more.")
  })
})
