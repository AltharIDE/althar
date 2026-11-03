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

import type { FoundTask, ProjectSummary } from '@althar/contracts'
import { FoundState } from '@althar/ui'

import type { Client } from '../src/renderer/data/client'
import type { Host } from '../src/renderer/data/services'
import { PAUSE_MS, rowOf, stateOf } from '../src/renderer/features/finder/useFinder'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { fakeClient, fakeHost, project } from './fixtures'
import { withServices } from './render'

/* The keys are read once from the system the window runs on (the kit's keys.ts), a Mac here; a test off a Mac says so through this. */
const system = vi.hoisted(() => ({ offMac: false }))
vi.mock('@althar/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@althar/ui')>()
  return { ...actual, primaryDown: (event: KeyboardEvent) => (system.offMac ? event.ctrlKey && !event.metaKey : actual.primaryDown(event)) }
})

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'halyard', slug: 'halyard', ink: 'teal' }

const found = (over: Partial<FoundTask> = {}): FoundTask => ({
  taskId: 'task_1',
  threadId: 'th1',
  projectId: 'p1',
  title: 'Retry webhook deliveries',
  slug: 'retry-webhook-deliveries',
  phase: 'running',
  state: 'open',
  pullRequest: '#1206',
  changedAt: '2026-10-14T09:00:00.000Z',
  matched: null,
  ...over,
})

const RECENT = {
  tasks: [found(), found({ taskId: 'task_2', threadId: 'th2', title: 'Tidy the logs', phase: 'stopped', pullRequest: null })],
}
const RETRY = {
  tasks: [
    found(),
    found({
      taskId: 'task_9',
      threadId: 'th9',
      projectId: 'p2',
      title: 'Charges time out',
      phase: 'ready',
      matched: [
        { text: 'Bounded ', hit: false },
        { text: 'retries', hit: true },
      ],
    }),
  ],
}

function Where() {
  return <p data-testid="where">{useRouterState({ select: (state) => state.location.pathname })}</p>
}
/* A screen with a field to type in, as a task's composer is. */
function Writing() {
  return (
    <>
      <Where />
      <textarea aria-label="Message the lead" />
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
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: Writing })
const threadRoute = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: Where })

const windowAt = (path: string, host: Host = fakeHost(), searchTasks?: Client['searchTasks']) => {
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, threadRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project, halyard] })),
    searchTasks: searchTasks ?? vi.fn(async ({ text }) => (text === '' ? RECENT : RETRY)),
  })
  withServices(<RouterProvider router={router} />, client, host)
  return { client, router }
}

const where = () => screen.getByTestId('where').textContent
const finder = () => screen.findByRole('dialog', { name: 'Find a task' })

beforeEach(() => {
  window.localStorage.clear()
  system.offMac = false
})

describe('finding a task', () => {
  it('opens on ⌘K in a project, searching it as the words pause, and opens the task chosen', async () => {
    const { client } = windowAt('/projects/p1')
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const dialog = await finder()
    const field = within(dialog).getByRole('combobox', { name: 'Find a task in meridian' })
    // With no words, the tasks changed last.
    await within(dialog).findByRole('option', { name: /Tidy the logs/ })
    expect(client.searchTasks).toHaveBeenLastCalledWith({ text: '', projectId: 'p1' })
    await userEvent.type(field, 'retr')
    // Searched once, for the words as they stood when typing paused; what was found before stays meanwhile.
    expect(within(dialog).getAllByRole('option')).toHaveLength(2)
    await waitFor(() => expect(client.searchTasks).toHaveBeenLastCalledWith({ text: 'retr', projectId: 'p1' }))
    expect(vi.mocked(client.searchTasks).mock.calls.filter(([input]) => input.text !== '')).toHaveLength(1)
    const option = await within(dialog).findByRole('option', { name: /Charges time out/ })
    expect(option.textContent).toContain('Ready')
    expect(option.querySelector('mark')?.textContent).toBe('retries')
    // In one project, no project is named.
    expect(option.textContent).not.toContain('halyard')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(where()).toBe('/threads/th9'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('searches every project on the home, naming each', async () => {
    const { client } = windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'K', metaKey: true })
    const dialog = await finder()
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Find a task in any project' }), 'retry')
    const option = await within(dialog).findByRole('option', { name: /Charges time out/ })
    expect(option.textContent).toContain('halyard')
    expect(client.searchTasks).toHaveBeenLastCalledWith({ text: 'retry' })
    await userEvent.click(within(dialog).getByRole('option', { name: /Retry webhook deliveries/ }))
    await waitFor(() => expect(where()).toBe('/threads/th1'))
  })

  it('opens from a field being typed in, and Escape gives the field its focus back', async () => {
    windowAt('/projects/p1')
    const message = await screen.findByRole('textbox', { name: 'Message the lead' })
    message.focus()
    fireEvent.keyDown(message, { key: 'k', metaKey: true })
    const dialog = await finder()
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('combobox')))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(message)
  })

  it('takes Control-K off a Mac, and not ⌘ there', async () => {
    system.offMac = true
    windowAt('/projects/p1', fakeHost({ platform: 'linux' }))
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true })
    await act(async () => await new Promise((done) => setTimeout(done, PAUSE_MS)))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await finder()
  })

  it('shows the field alone until the first answer comes', async () => {
    let answer: (found: { tasks: ReadonlyArray<FoundTask> }) => void = () => {}
    windowAt(
      '/projects/p1',
      fakeHost(),
      vi.fn(() => new Promise<{ tasks: ReadonlyArray<FoundTask> }>((done) => (answer = done))),
    )
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const dialog = await finder()
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    act(() => answer(RECENT))
    await within(dialog).findByRole('listbox', { name: 'Recent' })
  })
})

describe('a found task, as the finder lists it', () => {
  it('says where it stands in a word', () => {
    expect(stateOf(found({ phase: 'planned' }))).toBe(FoundState.Planned)
    expect(stateOf(found({ phase: 'held' }))).toBe(FoundState.Planned)
    expect(stateOf(found({ phase: 'running' }))).toBe(FoundState.Running)
    expect(stateOf(found({ phase: 'waiting' }))).toBe(FoundState.Yours)
    expect(stateOf(found({ phase: 'ready' }))).toBe(FoundState.Ready)
    expect(stateOf(found({ phase: 'stopped' }))).toBe(FoundState.Stopped)
    expect(stateOf(found({ phase: 'settled', state: 'done' }))).toBe(FoundState.Merged)
    expect(stateOf(found({ phase: 'settled', state: 'done', pullRequest: null }))).toBe(FoundState.Done)
    expect(stateOf(found({ phase: 'settled', state: 'abandoned' }))).toBe(FoundState.Abandoned)
  })

  it('opens by its thread, with its project only where one is given', () => {
    expect(rowOf(found({ pullRequest: null }), undefined)).toEqual({
      id: 'th1',
      title: 'Retry webhook deliveries',
      state: FoundState.Running,
    })
    expect(rowOf(found({ matched: [{ text: 'x', hit: true }] }), halyard)).toMatchObject({
      project: { seed: 'p2', name: 'halyard', ink: 'teal' },
      pullRequest: '#1206',
      matched: [{ text: 'x', hit: true }],
    })
  })
})
