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
import { entriesFor, withTaskActions } from '../src/renderer/features/finder/entries'
import { entriesOf, type EntryChanges, nothingHeld, withChanges } from '../src/renderer/features/finder/held'
import { search, type Ask, type Context } from '../src/renderer/features/finder/model'
import { draftKey, draftOf } from '../src/renderer/shared/drafts'
import { change, fakeClient, project, snapshot } from './fixtures'
import { withServices } from './render'

class RankWorker {
  static hold = false
  static pending: Array<() => void> = []
  held = nothingHeld
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage(message: { type: string; changes: EntryChanges; id: number; query: string; context: Context; ask: Ask }) {
    if (message.type === 'entries') this.held = withChanges(this.held, message.changes)
    else {
      const results = search(entriesOf(this.held), message.query, message.context, message.ask)
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
const windowAt = (overrides: Partial<Client> = {}, initial = '/projects/p1') => {
  const router = createRouter({
    routeTree: root.addChildren([home, projectRoute, thread, settings]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 0, projects: [{ ...project, coordinatorThreadId: 'co1' }] })),
    getSearchDocuments: vi.fn(async () => ({ documents, next: null, indexed: true })),
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
  it('waits until the palette opens to read search, opens a result, and restores focus on Escape', async () => {
    const client = windowAt()
    const message = await screen.findByRole('textbox', { name: 'Message' })
    expect(client.getSearchDocuments).not.toHaveBeenCalled()
    message.focus()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    await userEvent.type(field, 'retry')
    await within(dialog).findByRole('option', { name: /Retry checkout deliveries/ })
    expect(client.getSearchDocuments).toHaveBeenCalledWith(undefined, { text: 'retry' }, expect.any(AbortSignal))
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
  it("lists the top hit's actions when → is pressed while ranking, once it settles", async () => {
    windowAt()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    RankWorker.hold = true
    await userEvent.type(field, 'database')
    await within(dialog).findByRole('option', { name: /Start a task/ })
    await userEvent.keyboard('{ArrowRight}')
    const pending = RankWorker.pending.splice(0)
    await act(async () => pending.at(-1)?.())
    await within(dialog).findByRole('option', { name: 'Copy' })
  })
  it('is chosen by a pointer that moves, not by one at rest under a list that redraws', async () => {
    windowAt()
    const dialog = await open()
    const field = within(dialog).getByRole('combobox')
    await userEvent.type(field, 'database')
    const top = await within(dialog).findByRole('option', { name: /Compact the database/ })
    const ask = within(dialog).getByRole('option', { name: /Ask the coordinator/ })
    fireEvent.mouseMove(ask, { movementX: 0, movementY: 0 })
    expect(top.getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseMove(ask, { movementX: 3, movementY: 2 })
    expect(ask.getAttribute('aria-selected')).toBe('true')
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

const permission = {
  id: 'a1',
  kind: 'permission' as const,
  stuck: null,
  title: 'Read project logs',
  reason: 'The task asks for access.',
  command: null,
  createdAt: '2026-11-13T00:00:00.000Z',
}
const activeThread = (task: Partial<ReturnType<typeof snapshot>['task']> = {}) =>
  snapshot({
    attention: [permission],
    task: { ...snapshot().task, phase: 'ready', actions: ['stop', 'resume'], changes: [change()], ...task },
  })
const select = async (dialog: HTMLElement, query: string, result: RegExp) => {
  const field = within(dialog).getByRole('combobox')
  await userEvent.type(field, query)
  return within(dialog).findByRole('option', { name: result })
}
const chooseAction = async (name: RegExp) => {
  const dialog = await open()
  await select(dialog, 'retry checkout', /Retry checkout deliveries/)
  await userEvent.keyboard('{ArrowRight}')
  return within(dialog).findByRole('option', { name })
}

describe('Finder actions in a home window', () => {
  it('keeps approvals and merging out of the remote action list while offering task actions', async () => {
    const identity = { homeId: 'home_remote', actorId: 'actor_remote', deviceId: 'device_remote', role: 'socket' as const }
    const client = windowAt(
      {
        getThread: vi.fn(async () => activeThread()),
        getSearchFiles: vi.fn(async () => ({ files: ['src/private-module.ts'] })),
        connection: {
          identity,
          hostDeviceId: 'device_host',
          apiVersion: 1,
          appVersion: 'test',
          position: { homeId: identity.homeId, cursor: 0, checkpoint: null },
        },
      },
      '/threads/th1',
    )
    const dialog = await open()
    await select(dialog, 'retry checkout', /Retry checkout deliveries/)
    await userEvent.keyboard('{ArrowRight}')
    await within(dialog).findByRole('option', { name: 'Resume task' })
    expect(within(dialog).queryByRole('option', { name: /Allow Read project logs|Merge #12/ })).toBeNull()
    await userEvent.keyboard('{Escape}{Escape}')
    const files = await open()
    await userEvent.type(within(files).getByRole('combobox'), 'private-module.ts')
    await within(files).findByRole('option', { name: /Ask the coordinator/ })
    expect(within(files).queryByRole('option', { name: /^private-module\.ts(?: ·|$)/ })).toBeNull()
    expect(client.answer).not.toHaveBeenCalled()
    expect(client.merge).not.toHaveBeenCalled()
    expect(client.openCode).not.toHaveBeenCalled()
    expect(client.listEditors).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    const homes = vi.fn()
    window.addEventListener('althar:show-homes', homes)
    try {
      const again = await open()
      await userEvent.click(await select(again, '>new project', /^New project$/))
      await waitFor(() => expect(homes).toHaveBeenCalledOnce())
    } finally {
      window.removeEventListener('althar:show-homes', homes)
    }
  })

  it.each([
    [/Allow Read project logs/, 'answer', [{ attentionId: 'a1', decision: 'allow' }]],
    [/Merge #12/, 'merge', ['t1', 'abc123', change().url]],
    [/Stop task/, 'stopTask', ['t1']],
    [/Resume task/, 'resumeTask', [{ taskId: 't1' }]],
  ] as const)('runs the chosen local task action %s for the selected task', async (name, method, args) => {
    const client = windowAt({ getThread: vi.fn(async () => activeThread()) }, '/threads/th1')
    await userEvent.click(await chooseAction(name))
    await waitFor(() => expect(client[method]).toHaveBeenCalledExactlyOnceWith(...args))
  })

  it('keeps a failed action visible after search closes and retries on request', async () => {
    const stopTask = vi.fn().mockRejectedValueOnce(new Error('The task was busy.')).mockResolvedValueOnce(undefined)
    windowAt({ getThread: vi.fn(async () => activeThread()), stopTask }, '/threads/th1')
    await userEvent.click(await chooseAction(/Stop task/))
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toContain('The task was busy.')
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    expect(stopTask).toHaveBeenCalledTimes(1)
    await userEvent.click(within(notice).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(stopTask).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('opens a matching local file in the selected editor', async () => {
    const client = windowAt({ getSearchFiles: vi.fn(async () => ({ files: ['src/worker-example.ts'] })) })
    const dialog = await open()
    await userEvent.click(await select(dialog, 'worker-example', /worker-example.ts/))
    await waitFor(() => expect(client.openCode).toHaveBeenCalledWith({ threadId: 'co1', path: 'src/worker-example.ts', editor: 'zed' }))
  })

  it('opens editor settings when a matching local file has no available editor', async () => {
    const client = windowAt({
      listEditors: vi.fn(async () => []),
      getSearchFiles: vi.fn(async () => ({ files: ['src/worker-example.ts'] })),
    })
    const dialog = await open()
    await userEvent.click(await select(dialog, 'worker-example', /worker-example.ts/))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings/editor-and-browser'))
    expect(client.openCode).not.toHaveBeenCalled()
  })
})

it('links passages, issues and pull requests to the right project or task', () => {
  const context: Context = { project: 'p1', task: 't1', projects: [project], usage: {} }
  const all = entriesFor(
    [
      doc({ state: 'stopped' }),
      doc({ id: 'issue:1', kind: 'issue', ref: 'DEV-1', state: 'In review', url: 'https://example.test/issue/1', projectId: 'other' }),
      doc({ id: 'pull:1', kind: 'pull', ref: '#12', url: 'https://example.test/pull/12', state: 'open' }),
      doc({ id: 'issue:2', kind: 'issue', state: '', taskId: null, ref: '' }),
      doc({ id: 'said:1', kind: 'said', itemId: 'item-task' }),
      doc({ id: 'said:2', kind: 'said', taskId: null, itemId: 'item-project', threadId: 'co1' }),
      doc({ id: 'conversation:1', kind: 'conversation', taskId: null, threadId: null }),
      doc({ id: 'task:no-thread', threadId: null, taskId: 'other', state: 'unknown' }),
    ],
    [project],
    context,
    ['src/worker-example.ts'],
    'th1',
  )
  const byId = (id: string) => all.find((one) => one.id === id)
  expect(byId('task:t1')?.keys).toEqual(['retry-checkout', 'DEV-1', '#12'])
  expect(byId('issue:1')).toMatchObject({
    stand: { word: 'In review' },
    projectName: '',
    acts: [{ id: 'open' }, { id: 'host' }, { id: 'copy' }],
  })
  expect(byId('issue:2')?.stand).toBeUndefined()
  expect(byId('said:1')?.go).toEqual({ to: 'task', slug: 'th1', at: 'item-task' })
  expect(byId('said:2')?.go).toMatchObject({ to: 'project', at: 'item-project', threadId: 'co1' })
  expect(byId('conversation:1')?.go).toMatchObject({ to: 'project' })
  expect(byId('task:no-thread')?.go).toEqual({ to: 'task', slug: '' })
  expect(byId('file:th1:src/worker-example.ts')?.title).toBe('worker-example.ts')
  expect(byId('action:task:t1:resume')?.go).toEqual({ to: 'command', command: 'resume', taskId: 't1' })
  const hydrated = withTaskActions(
    all,
    activeThread({
      phase: 'running',
      mergeable: true,
      actions: ['resume'],
      changes: [change(), change({ state: 'merged' }), change({ head: null }), change({ queued: true })],
    }),
  )
  expect(hydrated.find((one) => one.id === 'task:t1')?.acts?.map((a) => a.id)).toEqual([
    'allow:a1',
    `merge:${change().url}`,
    'resume',
    'open',
    'copy',
  ])
})

it('recovers retrieved file names after a failed read and allows dismissing an editor refusal', async () => {
  const getSearchFiles = vi
    .fn()
    .mockRejectedValueOnce(new Error('Read failed'))
    .mockResolvedValueOnce({ files: ['src/worker-example.ts'] })
  const client = windowAt({ getSearchFiles, openCode: vi.fn(async () => false) })
  const dialog = await open()
  const retry = await within(dialog).findByRole('button', { name: 'Try again' })
  expect(within(dialog).getByRole('status').textContent).toContain('File names could not be read')
  await userEvent.click(retry)
  await userEvent.click(await select(dialog, 'worker-example', /worker-example.ts/))
  const notice = await screen.findByRole('alert')
  expect(notice.textContent).toContain('The file could not be opened.')
  await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(client.openCode).toHaveBeenCalledOnce()
})

it('navigates to a saved project note even when recent-search storage contains old entries', async () => {
  localStorage.setItem(
    'althar.search.uses',
    JSON.stringify({
      'note:n1': { n: 2, at: 1 },
      oldNull: null,
      oldString: 'note',
      oldCount: { n: 'two', at: 1 },
      oldNegative: { n: -1, at: 1 },
      oldDate: { n: 1, at: 'yesterday' },
    }),
  )
  windowAt()
  const dialog = await open()
  await userEvent.click(await select(dialog, '!rebase', /Always merge main/))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull())
  expect(screen.getByTestId('where').textContent).toBe('/projects/p1')
  const used = JSON.parse(localStorage.getItem('althar.search.uses') ?? '{}')
  expect(used).toEqual({ 'note:n1': { n: 3, at: expect.any(Number) } })
})

it('refreshes an older home’s catalog after a failed read', async () => {
  const getSearchDocuments = vi
    .fn()
    .mockRejectedValueOnce(new Error('Catalog unavailable'))
    .mockResolvedValueOnce({ documents: [documents[0]], next: 'second' })
    .mockResolvedValueOnce({ documents: documents.slice(1), next: null })
  windowAt({ getSearchDocuments })
  const dialog = await open()
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Try again' }))
  await select(dialog, 'compact', /Compact the database/)
  expect(getSearchDocuments).toHaveBeenCalledWith('second', undefined, expect.any(AbortSignal))
})

it('finds project names and returns all-home search results from Home', async () => {
  windowAt({}, '/')
  const dialog = await open()
  await userEvent.click(await select(dialog, '>meridian', /^meridian · meridian$/i))
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/projects/p1'))
  const again = await open()
  await userEvent.click(await select(again, '>home', /^Home$/))
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
})
