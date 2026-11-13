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
import type { SearchDocument } from '@althar/contracts'
import type { Client } from '../src/renderer/data/client'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { search, type Ask, type Context, type Entry } from '../src/renderer/features/finder/model'
import { draftKey, draftOf } from '../src/renderer/shared/drafts'
import { fakeClient, project } from './fixtures'
import { withServices } from './render'

class RankWorker {
  static hold = false
  static pending: Array<() => void> = []
  entries: ReadonlyArray<Entry> = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage(message: { type: string; entries: ReadonlyArray<Entry>; id: number; query: string; context: Context; ask: Ask }) {
    if (message.type === 'entries') this.entries = message.entries
    else {
      const results = search(this.entries, message.query, message.context, message.ask)
      const answer = () => this.onmessage?.({ data: { id: message.id, results } } as MessageEvent)
      if (RankWorker.hold) RankWorker.pending.push(answer)
      else queueMicrotask(answer)
    }
  }
  terminate() {}
}
const doc = (over: Partial<SearchDocument> = {}): SearchDocument => ({
  id: 'task:t1',
  kind: 'task',
  projectId: 'p1',
  threadId: 'th1',
  taskId: 't1',
  itemId: null,
  title: 'Retry checkout deliveries',
  body: 'Use bounded retries',
  ref: 'retry-checkout',
  url: null,
  changedAt: '2026-11-13T00:00:00.000Z',
  state: 'running',
  ...over,
})
const documents = [
  doc(),
  doc({ id: 'task:t2', taskId: 't2', threadId: 'th2', title: 'Compact the database', ref: 'compact-database', state: 'ready' }),
  doc({
    id: 'note:n1',
    kind: 'note',
    taskId: null,
    threadId: 'co1',
    title: 'Always merge main; never rebase a published branch.',
    ref: '',
    body: 'Always merge main; never rebase a published branch.',
  }),
]
function Where() {
  return (
    <>
      <p data-testid="where">{useRouterState({ select: (state) => state.location.pathname })}</p>
      <textarea aria-label="Message" />
    </>
  )
}
const root = createRootRoute({
  component: () => (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  ),
})
const home = createRoute({ getParentRoute: () => root, path: '/', component: Where })
const projectRoute = createRoute({ getParentRoute: () => root, path: '/projects/$projectId', component: Where })
const thread = createRoute({ getParentRoute: () => root, path: '/threads/$threadId', component: Where })
const settings = createRoute({ getParentRoute: () => root, path: '/settings/$section', component: Where })
const windowAt = (overrides: Partial<Client> = {}) => {
  const router = createRouter({
    routeTree: root.addChildren([home, projectRoute, thread, settings]),
    history: createMemoryHistory({ initialEntries: ['/projects/p1'] }),
  })
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 0, projects: [{ ...project, coordinatorThreadId: 'co1' }] })),
    getSearchDocuments: vi.fn(async () => ({ documents, next: null })),
    ...overrides,
  })
  withServices(<RouterProvider router={router} />, client)
  return client
}
const open = async () => {
  await screen.findByRole('navigation', { name: 'Projects' })
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  return screen.findByRole('dialog', { name: 'Search' })
}

beforeEach(() => {
  vi.stubGlobal('Worker', RankWorker)
  RankWorker.hold = false
  RankWorker.pending = []
})
describe('search across Althar', () => {
  it('searches without a runtime call per key, opens a result, and restores focus on Escape', async () => {
    const client = windowAt()
    const message = await screen.findByRole('textbox', { name: 'Message' })
    message.focus()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    await userEvent.type(field, 'retry')
    await within(dialog).findByRole('option', { name: /Retry checkout deliveries/ })
    expect(client.getSearchDocuments).toHaveBeenCalledTimes(1)
    expect(client.searchTasks).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(message)
    const again = await open()
    await userEvent.type(within(again).getByRole('combobox'), 'retry')
    await within(again).findByRole('option', { name: /Retry checkout deliveries/ })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/threads/th1'))
  })
  it('uses prefixes, backs out of actions, and puts a question in the coordinator draft', async () => {
    windowAt()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    await userEvent.type(field, '!rebase')
    await within(dialog).findByRole('option', { name: /Always merge main/ })
    await userEvent.keyboard('{ArrowRight}')
    await within(dialog).findByRole('option', { name: 'Copy' })
    await userEvent.keyboard('{Escape}{Escape}')
    await userEvent.clear(field)
    await userEvent.type(field, 'why merge main?')
    await userEvent.keyboard('{Tab}')
    expect(field.getAttribute('placeholder')).toContain('Ask')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(draftOf(draftKey.coordinator('p1')).text).toBe('why merge main?'))
  })
  it('chooses the top hit once the results show, not a row of the list typed over', async () => {
    windowAt()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    RankWorker.hold = true
    await userEvent.type(field, 'database')
    // While ranking: the words' own rows stand in, and the choice may rest on one.
    await within(dialog).findByRole('option', { name: /Start a task/ })
    const pending = RankWorker.pending.splice(0)
    await act(async () => pending.at(-1)?.())
    const top = await within(dialog).findByRole('option', { name: /Compact the database/ })
    expect(top.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowRight}')
    await within(dialog).findByRole('option', { name: 'Copy' })
  })
  it('keeps results visible and ignores late replies to older words', async () => {
    windowAt()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    await userEvent.type(field, 'retry')
    await within(dialog).findByRole('option', { name: /Retry checkout deliveries/ })
    RankWorker.hold = true
    await userEvent.clear(field)
    await userEvent.type(field, 'database')
    expect(within(dialog).getByRole('option', { name: /Retry checkout deliveries/ })).toBeTruthy()
    const pending = RankWorker.pending.splice(0)
    await act(async () => pending.at(-1)?.())
    await within(dialog).findByRole('option', { name: /Compact the database/ })
    await act(async () => pending.slice(0, -1).forEach((answer) => answer()))
    expect(within(dialog).queryByRole('option', { name: /Retry checkout deliveries/ })).toBeNull()
  })
})
