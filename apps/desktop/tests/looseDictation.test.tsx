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

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { coveredNow } from '../src/renderer/features/browser/cover'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { CarriedOver } from '../src/renderer/shared/dictation/Carried'
import { record } from '../src/renderer/shared/dictation/recorder'
import { forgetSessions } from '../src/renderer/shared/dictation/sessions'
import { cancelIn, pressDictationShortcut, useDictation } from '../src/renderer/shared/dictation/useDictation'
import { draftKey, draftOf, forgetDrafts, setDraftDictated, setDraftText, useDraft } from '../src/renderer/shared/drafts'
import { fakeClient, fakeHost, project } from './fixtures'
import { withServices } from './render'

/*
 * Dictation from anywhere: the shortcut starts it where no composer shows (the
 * home, a board, the settings), the pill says it isn't placed yet, and once it
 * is written down the person chooses where it goes. Where a composer shows,
 * the shortcut is still that composer's.
 */

const READY: DictationState = {
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  model: { name: 'Parakeet', ready: true, got: 1, size: 1, downloading: false },
}

const speech = () => {
  const dictation: DictationHost = {
    state: vi.fn(async () => READY),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => 'Check the retry path.'),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn(() => () => {}),
  }
  return dictation
}

// A microphone that heard two seconds of something.
vi.mock('../src/renderer/shared/dictation/recorder', () => ({
  record: vi.fn(async () => {
    const heard = () => ({ samples: new Float32Array(32_000), sampleRate: 16_000 })
    return { peek: heard, stop: heard, cancel: vi.fn(), use: vi.fn(async () => {}) }
  }),
}))

class RankWorker {
  entries: ReadonlyArray<unknown> = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage(message: { type: string; entries: ReadonlyArray<unknown>; id: number; query: string; context: unknown; ask: unknown }) {
    if (message.type === 'entries') this.entries = message.entries
    else {
      void import('../src/renderer/features/finder/model').then(({ search }) => {
        const results = search(this.entries as never, message.query, message.context as never, message.ask as never)
        this.onmessage?.({ data: { id: message.id, results } } as MessageEvent)
      })
    }
  }
  terminate() {}
}

const task: SearchDocument = {
  id: 'task:t1',
  kind: 'task',
  projectId: 'p1',
  threadId: 'th1',
  taskId: 't1',
  itemId: null,
  title: 'Retry checkout deliveries',
  body: '',
  ref: 'retry-checkout',
  url: null,
  changedAt: '2026-11-13T00:00:00.000Z',
  state: 'running',
}

/** A screen of the window with no composer, that says where it is. */
function Board() {
  return <p data-testid="where">{useRouterState({ select: (state) => state.location.pathname })}</p>
}
/** A screen with a composer, as a task's: dictating where it is. */
function WithComposer() {
  const [text, setText] = useDraft('thread:th1')
  const voice = useDictation('thread:th1', {
    projectId: 'p1',
    to: {
      to: 'The task',
      back: { kind: 'task', threadId: 'th1' },
      threadId: 'th1',
      send: 'Send to the task',
      take: 'Move it to this task',
    },
  })
  return (
    <>
      <textarea aria-label="Message" ref={voice.inputRef} value={text} onChange={(event) => setText(event.target.value)} />
      <CarriedOver here="thread:th1" />
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
const routes = (composer: boolean) => [
  createRoute({ getParentRoute: () => root, path: '/', component: Board }),
  createRoute({ getParentRoute: () => root, path: '/projects/$projectId', component: composer ? WithComposer : Board }),
  createRoute({ getParentRoute: () => root, path: '/threads/$threadId', component: Board }),
  createRoute({ getParentRoute: () => root, path: '/settings/$section', component: Board }),
]

const windowAt = (path: string, { composer = false, dictation = speech() as DictationHost | undefined } = {}) => {
  const router = createRouter({
    routeTree: root.addChildren(routes(composer)),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 0, projects: [{ ...project, coordinatorThreadId: 'co1' }] })),
    getSearchDocuments: vi.fn(async () => ({ documents: [task], next: null })),
  })
  const host = fakeHost(dictation === undefined ? {} : { dictation })
  withServices(<RouterProvider router={router} />, client, host)
  return { client, host, dictation, router }
}

const SHORTCUT = { key: 'd', metaKey: true, shiftKey: true }
const press = () => act(() => void fireEvent.keyDown(window, SHORTCUT))

beforeEach(() => {
  vi.stubGlobal('Worker', RankWorker)
  forgetSessions()
  forgetDrafts()
  window.localStorage.clear()
  vi.mocked(record).mockClear()
})

describe('dictation from anywhere', () => {
  it('starts with the shortcut where no composer shows, and says it isn’t placed yet', async () => {
    windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    const pill = await screen.findByRole('group', { name: 'Not placed yet' })
    // The same key stops it, and it is written down.
    press()
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Check the retry path.')
    expect(pill.isConnected).toBe(false)
  })

  it('places what was said in a task’s composer, and goes there', async () => {
    windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    await userEvent.click(within(card).getByRole('button', { name: 'Place it in…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    const field = within(dialog).getByRole('combobox')
    expect(field.getAttribute('placeholder')).toBe('Place it in a project or a task…')
    await userEvent.type(field, 'retry')
    await within(dialog).findByRole('option', { name: /Retry checkout deliveries/ })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/threads/th1'))
    expect(draftOf(draftKey.task('th1'))).toMatchObject({ text: 'Check the retry path.', dictated: true })
    // Nothing is carried once it is placed.
    expect(screen.queryByRole('region', { name: 'Not placed yet' })).toBeNull()
    expect(draftOf(draftKey.loose).text).toBe('')
  })

  it('places what was said with a project’s coordinator, after what is there', async () => {
    windowAt('/settings/agents')
    await screen.findByRole('navigation', { name: 'Projects' })
    act(() => void fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true }))
    await screen.findByRole('group', { name: 'Not placed yet' })
    act(() => void fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true }))
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    await act(async () => (await import('../src/renderer/shared/drafts')).setDraftText(draftKey.coordinator('p1'), 'Already here.'))
    await userEvent.click(within(card).getByRole('button', { name: 'Place it in…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    await userEvent.type(within(dialog).getByRole('combobox'), project.name)
    await userEvent.click(await within(dialog).findByRole('option', { name: new RegExp(`^${project.name}`, 'i') }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/projects/p1'))
    expect(draftOf(draftKey.coordinator('p1')).text).toBe('Already here.\n\nCheck the retry path.')
  })

  it('throws it away when asked', async () => {
    windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    await userEvent.click(within(card).getByRole('button', { name: 'Throw it away' }))
    expect(screen.queryByRole('region', { name: 'Not placed yet' })).toBeNull()
    expect(draftOf(draftKey.loose).text).toBe('')
  })

  it('is the composer’s where the cursor is in it: what is said lands in it, with nothing carried', async () => {
    windowAt('/projects/p1', { composer: true })
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    box.focus()
    press()
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Not placed yet' })).toBeNull())
    press()
    await waitFor(() => expect(box.value).toBe('Check the retry path.'))
    expect(screen.queryByRole('region', { name: 'Not placed yet' })).toBeNull()
  })

  it('is the window’s where a composer shows but the cursor is elsewhere: placed afterwards, the composer untouched', async () => {
    windowAt('/projects/p1', { composer: true })
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    expect(document.activeElement).not.toBe(box)
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Check the retry path.')
    expect(box.value).toBe('')
    // The composer on screen can have it instead.
    await userEvent.click(within(card).getByRole('button', { name: /^Move it to/ }))
    await waitFor(() => expect(box.value).toBe('Check the retry path.'))
    expect(screen.queryByRole('region', { name: 'Not placed yet' })).toBeNull()
  })

  it('stops what listens, carried from a composer, rather than starting another', async () => {
    const { router } = windowAt('/projects/p1', { composer: true })
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    box.focus()
    press()
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    await act(async () => await router.navigate({ to: '/settings/$section', params: { section: 'agents' } }))
    await screen.findByRole('group', { name: 'The task' })
    // The page's key, or the search's action: it stops the one carried.
    act(() => pressDictationShortcut())
    await screen.findByRole('region', { name: 'The task' })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('keeps what was said unplaced when a second recording comes to nothing', async () => {
    windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    await screen.findByRole('region', { name: 'Not placed yet' })
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    act(() => cancelIn(draftKey.loose))
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Check the retry path.')
  })

  it('keeps what was said unplaced when a second recording fails to be written and is thrown away', async () => {
    const { dictation } = windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    await screen.findByRole('region', { name: 'Not placed yet' })
    vi.mocked(dictation!.transcribe).mockRejectedValue(new Error('No.'))
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    press()
    const failed = await screen.findByRole('region', { name: 'Not placed yet' })
    await userEvent.click(within(failed).getByRole('button', { name: 'Throw it away' }))
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Check the retry path.')
  })

  it('carries what was said and not placed again when the window is reopened', async () => {
    setDraftText(draftKey.loose, 'Said before the window closed.')
    setDraftDictated(draftKey.loose, true)
    windowAt('/')
    const card = await screen.findByRole('region', { name: 'Not placed yet' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Said before the window closed.')
  })

  it('draws at the body’s end, where a page in a tab steps aside for it', async () => {
    windowAt('/')
    const root = (await screen.findByRole('navigation', { name: 'Projects' })).closest('body > div')
    const place = { x: 0, y: 0, width: 1000, height: 1000 }
    // jsdom lays nothing out: its boxes are given.
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 200))
    expect(coveredNow(root, place)).toBe(false)
    press()
    await screen.findByRole('group', { name: 'Not placed yet' })
    expect(coveredNow(root, place)).toBe(true)
    box.mockRestore()
  })

  it('does nothing where the window can’t dictate', async () => {
    windowAt('/', { dictation: undefined })
    await screen.findByRole('navigation', { name: 'Projects' })
    press()
    expect(screen.queryByRole('group', { name: 'Not placed yet' })).toBeNull()
  })

  it('is in the search’s actions with its shortcut, where the window can dictate', async () => {
    windowAt('/')
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    await userEvent.type(within(dialog).getByRole('combobox'), 'dictate')
    const row = await within(dialog).findByRole('option', { name: /Dictate/ })
    expect(row.textContent).toContain('⌘⇧D')
    // Chosen, it starts, as its shortcut does.
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('group', { name: 'Not placed yet' })
  })
})
