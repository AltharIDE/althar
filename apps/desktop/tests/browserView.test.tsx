import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PageKey, PageLine, PageState, Pointed } from '../src/main/browser/page'
import type { Host, PagesHost } from '../src/renderer/data/services'
import { ServicesProvider } from '../src/renderer/data/services'
import { coveredNow } from '../src/renderer/features/browser/cover'
import { useOpener } from '../src/renderer/features/browser/opener'
import { forgetPages, pages, storedFrom, usePage } from '../src/renderer/features/browser/pages'
import { pageRoute } from '../src/renderer/features/browser/route'
import { rootRoute } from '../src/renderer/root'
import { PageView } from '../src/renderer/features/browser/PageView'
import { commentsOf, forgetComments, gather } from '../src/renderer/shared/comments'
import { fakeClient, fakeHost } from './fixtures'
import { servicesFor } from './render'

/*
 * A page beside a conversation, as the window shows it (ADR-100): the bar
 * drives the page in the main process, the page is laid where the panel
 * keeps its place and steps aside for what opens over it, a comment pointed
 * at it is written over a picture of it and waits in the conversation's
 * draft, and a run's or a link's address opens beside the conversation or
 * in the person's browser, as the person keeps links.
 */

const OWNER = `task_${'a1'.repeat(16)}`
const DRAFT = 'task:thr_1'
const PLACE = { x: 640, y: 120, width: 640, height: 700 }

const stateOf = (overrides: Partial<PageState> = {}): PageState => ({
  owner: OWNER,
  address: 'http://localhost:5173/refunds',
  title: 'Refunds',
  loading: false,
  back: true,
  forward: false,
  viewport: 'fit',
  pointing: false,
  line: null,
  ...overrides,
})

const pointed: Pointed = {
  picked: {
    selector: 'main > div.banner',
    label: 'div.banner',
    text: 'Something went wrong.',
    rect: { x: 24, y: 124, width: 592, height: 56 },
    font: '15px · 400 · Inter',
    colour: '#26262b',
    background: '#f6e3e1',
    page: { width: 640, height: 700 },
  },
  crop: null,
  cropSize: null,
  still: 'data:image/jpeg;base64,AAAA',
  scale: 1,
  at: { x: 24, y: 124, width: 592, height: 56 },
  address: 'http://localhost:5173/refunds',
  viewport: 'fit',
}

/** The main process's pages, as a test holds them: each call kept, and what it says of a page sent when the test says. */
const fakePages = () => {
  const states = new Set<(state: PageState) => void>()
  const keys = new Set<(owner: string, key: PageKey) => void>()
  const closings = new Set<(owner: string) => void>()
  const host: PagesHost = {
    open: vi.fn(async (owner: string, address: string) => stateOf({ owner, address })),
    states: vi.fn(async () => []),
    show: vi.fn(),
    move: vi.fn(async () => {}),
    viewport: vi.fn(async () => {}),
    point: vi.fn(async () => pointed),
    stopPointing: vi.fn(async () => {}),
    pins: vi.fn(async () => {}),
    find: vi.fn(async () => pointed),
    still: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
    cover: vi.fn(async () => {}),
    outside: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    clearAll: vi.fn(async () => {}),
    onState: (listener) => {
      states.add(listener)
      return () => void states.delete(listener)
    },
    onKey: (listener) => {
      keys.add(listener)
      return () => void keys.delete(listener)
    },
    onClosed: (listener) => {
      closings.add(listener)
      return () => void closings.delete(listener)
    },
  }
  return {
    host,
    // As main says it: heard by the window's store whether or not the view listens yet.
    say: (state: PageState) =>
      act(() => {
        pages.known(state)
        states.forEach((listener) => listener(state))
      }),
    press: (key: PageKey) => act(() => keys.forEach((listener) => listener(OWNER, key))),
    // A page main closed of itself, as its task was done.
    closed: (owner = OWNER) => act(() => closings.forEach((listener) => listener(owner))),
  }
}

/* The page's place has the panel's size: jsdom lays nothing out, so its box is the test's. */
let measured = PLACE
beforeEach(() => {
  measured = PLACE
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { x, y, width, height } = this.className.includes('place') ? measured : { x: 0, y: 0, width: 0, height: 0 }
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  forgetComments()
})

/** The page beside a task's conversation, in a window with a router, as its screen shows it. */
const shown = (pagesHost: PagesHost, onDock = vi.fn(), host: Host = fakeHost({ pages: pagesHost })) => {
  const root = createRootRoute({ component: () => <Outlet /> })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <PageView owner={OWNER} kind="task" draft={DRAFT} where="beside" onDock={onDock} />,
  })
  const settings = createRoute({ getParentRoute: () => root, path: '/settings/$section', component: () => <p>Settings</p> })
  const router = createRouter({ routeTree: root.addChildren([page, settings]), history: createMemoryHistory({ initialEntries: ['/'] }) })
  const view = render(
    <ServicesProvider value={servicesFor(fakeClient().client, host)}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )
  return { ...view, router, onDock }
}

const panel = () => screen.getByRole('complementary', { name: 'Page' })

describe('the page’s bar', () => {
  it('shows the page as main says it, and drives it: back, forward, reload, an address typed, its size, out, a tab', async () => {
    const fake = fakePages()
    const { onDock } = shown(fake.host)
    fake.say(stateOf())
    const bar = within(await screen.findByRole('complementary', { name: 'Page' }))
    expect((bar.getByRole('textbox', { name: 'Address' }) as HTMLInputElement | HTMLTextAreaElement).value).toBe('localhost:5173/refunds')
    expect((bar.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(bar.getByRole('button', { name: 'Back' }))
    await userEvent.click(bar.getByRole('button', { name: 'Reload' }))
    expect(fake.host.move).toHaveBeenCalledWith(OWNER, 'back')
    expect(fake.host.move).toHaveBeenCalledWith(OWNER, 'reload')
    await userEvent.click(bar.getByRole('textbox', { name: 'Address' }))
    await userEvent.keyboard('althar.ai/changelog{Enter}')
    expect(fake.host.open).toHaveBeenCalledWith(OWNER, 'althar.ai/changelog')
    await userEvent.click(bar.getByRole('button', { name: 'Viewport' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Phone/ }))
    expect(fake.host.viewport).toHaveBeenCalledWith(OWNER, 'phone')
    await userEvent.click(bar.getByRole('button', { name: 'Open in your browser' }))
    expect(fake.host.outside).toHaveBeenCalledWith(OWNER, 'page')
    await userEvent.click(bar.getByRole('button', { name: 'Open as a tab' }))
    expect(onDock).toHaveBeenCalled()
  })

  it('says loading with Stop, and the size it lays the page out at', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf({ loading: true, viewport: 'phone' }))
    const bar = within(await screen.findByRole('complementary', { name: 'Page' }))
    await userEvent.click(bar.getByRole('button', { name: 'Stop loading' }))
    expect(fake.host.move).toHaveBeenCalledWith(OWNER, 'stop')
    expect(bar.getByRole('button', { name: 'Viewport: Phone' }).textContent).toContain('390 × 844')
  })

  it('offers nothing to point at or open elsewhere before anything loaded, and says what will be there', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf({ address: '' }))
    await screen.findByRole('complementary', { name: 'Page' })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(screen.getByText('Type an address, or open a link from the conversation.')).toBeTruthy()
  })

  it('says how long its cookies are kept, goes where that is changed, and clears them at the person’s word', async () => {
    const fake = fakePages()
    const { router } = shown(fake.host)
    fake.say(stateOf())
    await userEvent.click(
      within(await screen.findByRole('complementary', { name: 'Page' })).getByRole('button', { name: 'Its own session' }),
    )
    expect(await screen.findByText('This task’s own session')).toBeTruthy()
    expect(screen.getByText('Cookies kept until the task is done.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clear its cookies and storage' }))
    expect(fake.host.clear).toHaveBeenCalledWith(OWNER)
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/browser'))
  })

  it('closes the page, which forgets it', async () => {
    const fake = fakePages()
    shown(fake.host)
    pages.place(OWNER, 'beside')
    fake.say(stateOf())
    await userEvent.click(within(await screen.findByRole('complementary', { name: 'Page' })).getByRole('button', { name: 'Close' }))
    expect(fake.host.close).toHaveBeenCalledWith(OWNER)
    expect(pages.where(OWNER)).toBeNull()
  })
})

describe('the line under the bar', () => {
  const lines: ReadonlyArray<readonly [PageLine, string, string | null]> = [
    [{ kind: 'refused', refusal: 'file' }, 'Files on this computer don’t open here.', null],
    [{ kind: 'refused', refusal: 'scheme' }, 'Only web pages open here.', null],
    [{ kind: 'refused', refusal: 'address' }, 'That isn’t a web address.', null],
    [{ kind: 'sign-in', service: 'Linear' }, 'Linear’s sign-in opened in your browser.', null],
    [
      { kind: 'asked', asked: 'camera', host: 'localhost:5173' },
      'localhost:5173 asked for the camera, which pages here don’t get.',
      'Open in your browser',
    ],
    [{ kind: 'download', name: 'report.csv', offered: true }, 'report.csv wasn’t downloaded here.', 'Download in your browser'],
    [{ kind: 'download', name: 'blob.bin', offered: false }, 'blob.bin wasn’t downloaded here.', null],
    [{ kind: 'failed', host: 'localhost:5173' }, 'localhost:5173 didn’t answer.', 'Reload'],
    [{ kind: 'gone' }, 'The page stopped.', 'Reload'],
  ]

  it.each(lines)('says %j plainly, with what can be done about it', async (line, words, action) => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf({ line }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(words)
    if (action !== null) await userEvent.click(within(status).getByRole('button', { name: action }))
    if (action === 'Open in your browser') expect(fake.host.outside).toHaveBeenCalledWith(OWNER, 'page')
    if (action === 'Download in your browser') expect(fake.host.outside).toHaveBeenCalledWith(OWNER, 'download')
    if (action === 'Reload') expect(fake.host.move).toHaveBeenCalledWith(OWNER, 'reload')
    const dismiss = within(status).queryByRole('button', { name: 'Dismiss' })
    if (dismiss !== null) {
      await userEvent.click(dismiss)
      expect(fake.host.dismiss).toHaveBeenCalledWith(OWNER)
    }
  })
})

describe('where the page is laid', () => {
  it('is the panel’s place, measured, and nowhere once the panel goes', async () => {
    const fake = fakePages()
    const { unmount } = shown(fake.host)
    fake.say(stateOf())
    await waitFor(() => expect(fake.host.show).toHaveBeenCalledWith(OWNER, PLACE))
    unmount()
    expect(fake.host.show).toHaveBeenLastCalledWith(OWNER, null)
  })

  it('steps aside for a picture of it while something of the window’s is over it, and comes back after', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf())
    await screen.findByRole('complementary', { name: 'Page' })
    const menu = document.createElement('div')
    menu.dataset.state = 'open'
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      x: 900,
      y: 140,
      width: 200,
      height: 200,
      left: 900,
      top: 140,
      right: 1100,
      bottom: 340,
    } as DOMRect)
    act(() => document.body.append(menu))
    await waitFor(() => expect(fake.host.still).toHaveBeenCalledWith(OWNER))
    const picture = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>('img[src="data:image/jpeg;base64,BBBB"]')
      if (found === null) throw new Error('No picture yet.')
      return found
    })
    fireEvent.load(picture)
    expect(fake.host.cover).toHaveBeenCalledWith(OWNER, true)
    act(() => menu.remove())
    await waitFor(() => expect(fake.host.cover).toHaveBeenLastCalledWith(OWNER, false))
  })
})

describe('a comment on the page', () => {
  it('is pointed at, written over a picture of the page, and waits in the conversation’s draft with its pin', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf())
    await userEvent.click(within(await screen.findByRole('complementary', { name: 'Page' })).getByRole('button', { name: 'Comment' }))
    expect(fake.host.point).toHaveBeenCalledWith(OWNER)
    const box = await screen.findByRole('textbox', { name: 'Comment on div.banner' })
    expect(document.querySelector('img[src="data:image/jpeg;base64,AAAA"]')).not.toBeNull()
    await userEvent.type(box, 'Say what happened.{Enter}')
    await waitFor(() => expect(commentsOf(DRAFT).map((one) => one.note)).toEqual(['Say what happened.']))
    await waitFor(() =>
      expect(fake.host.pins).toHaveBeenLastCalledWith(OWNER, [
        { n: 1, selector: 'main > div.banner', address: 'http://localhost:5173/refunds' },
      ]),
    )
    expect(screen.queryByRole('textbox', { name: 'Comment on div.banner' })).toBeNull()
  })

  it('stops pointing when Comment is pressed again, and is left with Escape', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf({ pointing: true }))
    await userEvent.click(within(await screen.findByRole('complementary', { name: 'Page' })).getByRole('button', { name: 'Comment' }))
    expect(fake.host.stopPointing).toHaveBeenCalledWith(OWNER)
    fake.say(stateOf())
    fake.press('comment')
    const box = await screen.findByRole('textbox', { name: 'Comment on div.banner' })
    await userEvent.type(box, 'Never mind{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Comment on div.banner' })).toBeNull()
    expect(commentsOf(DRAFT)).toEqual([])
  })

  it('opens again from its chip, on its element, to change it or take it off', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf())
    gather(DRAFT, {
      id: 'c1',
      note: 'First',
      on: { kind: 'page', picked: pointed.picked, address: pointed.address, viewport: 'fit' },
      crop: null,
    })
    act(() => pages.reopen(OWNER, 'c1'))
    const box = await screen.findByRole('textbox', { name: 'Comment on div.banner' })
    expect(fake.host.find).toHaveBeenCalledWith(OWNER, 'main > div.banner', 'http://localhost:5173/refunds')
    expect((box as HTMLInputElement | HTMLTextAreaElement).value).toBe('First')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(commentsOf(DRAFT)).toEqual([])
  })

  it('opens again over the page as it is where its element is gone, and saves what is changed', async () => {
    const fake = fakePages()
    vi.mocked(fake.host.find).mockResolvedValue(null)
    shown(fake.host)
    fake.say(stateOf())
    gather(DRAFT, {
      id: 'c1',
      note: 'First',
      on: { kind: 'page', picked: pointed.picked, address: pointed.address, viewport: 'fit' },
      crop: null,
    })
    act(() => pages.reopen(OWNER, 'c1'))
    const box = await screen.findByRole('textbox', { name: 'Comment on div.banner' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Changed{Enter}')
    await waitFor(() => expect(commentsOf(DRAFT)[0]?.note).toBe('Changed'))
  })

  it('focuses the address at the page’s own key', async () => {
    const fake = fakePages()
    shown(fake.host)
    fake.say(stateOf())
    await screen.findByRole('complementary', { name: 'Page' })
    fake.press('address')
    expect(document.activeElement).toBe(within(panel()).getByRole('textbox', { name: 'Address' }))
  })
})

describe('where an address from a conversation opens', () => {
  const wrapper =
    (host: Host) =>
    ({ children }: { children: ReactNode }) => (
      <ServicesProvider value={servicesFor(fakeClient().client, host)}>{children}</ServicesProvider>
    )

  it('a run’s and a link’s, beside the conversation, which comes to the front for it', async () => {
    const fake = fakePages()
    const onShow = vi.fn()
    const { result } = renderHook(() => useOpener(OWNER, onShow), { wrapper: wrapper(fakeHost({ pages: fake.host })) })
    act(() => result.current.run('http://localhost:5173/'))
    expect(pages.where(OWNER)).toBe('beside')
    expect(onShow).toHaveBeenCalled()
    expect(fake.host.open).toHaveBeenCalledWith(OWNER, 'http://localhost:5173/')
    await waitFor(() => expect(pages.state(OWNER)?.address).toBe('http://localhost:5173/'))
    expect(result.current.links).toBe('beside')
  })

  it('a link, in the person’s browser where they keep links there; a run’s still beside the conversation', async () => {
    const fake = fakePages()
    const host = fakeHost({ pages: fake.host })
    await host.setPreference('browserLinks', 'outside')
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { result } = renderHook(() => useOpener(OWNER), { wrapper: wrapper(host) })
    await waitFor(() => expect(result.current.links).toBe('outside'))
    act(() => result.current.link('https://althar.ai/changelog'))
    expect(opened).toHaveBeenCalledWith('https://althar.ai/changelog', '_blank')
    act(() => result.current.run('http://localhost:5173/'))
    expect(fake.host.open).toHaveBeenCalledWith(OWNER, 'http://localhost:5173/')
  })

  it('in the person’s browser where there is no conversation to be beside', () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { result } = renderHook(() => useOpener(null), { wrapper: wrapper(fakeHost()) })
    act(() => result.current.run('http://localhost:5173/'))
    expect(opened).toHaveBeenCalledWith('http://localhost:5173/', '_blank')
  })
})

describe('the pages this window shows', () => {
  it('each show in one place, a tab after the others, and remember the conversation they came from', () => {
    pages.place('task_a', 'tab', { kind: 'task', threadId: 'thr_a', draft: 'task:thr_a' })
    pages.place('task_b', 'beside')
    pages.place('proj_c', 'tab', { kind: 'project', projectId: 'proj_c', draft: 'coordinator:proj_c' })
    expect(pages.tabs()).toEqual(['task_a', 'proj_c'])
    pages.place('task_a', 'beside')
    pages.place('task_a', 'tab')
    expect(pages.tabs()).toEqual(['proj_c', 'task_a'])
    expect(pages.originOf('task_a')).toEqual({ kind: 'task', threadId: 'thr_a', draft: 'task:thr_a' })
    pages.hide('task_b')
    expect(pages.where('task_b')).toBeNull()
    // Closed, a page shows nowhere; where it came from stays, for its tab to go back to.
    pages.forget('task_a')
    expect(pages.where('task_a')).toBeNull()
    expect(pages.tabs()).toEqual(['proj_c'])
    expect(pages.originOf('task_a')).toEqual({ kind: 'task', threadId: 'thr_a', draft: 'task:thr_a' })
  })

  it('are heard from main as the window opens, after them, and forgotten as main closes one, its task done', async () => {
    const fake = fakePages()
    const open = stateOf({ address: 'http://localhost:5173/kept' })
    vi.mocked(fake.host.states).mockResolvedValue([open])
    renderHook(() => usePage(OWNER, fake.host))
    await waitFor(() => expect(pages.state(OWNER)).toEqual(open))
    act(() => pages.place(OWNER, 'beside'))
    fake.closed()
    expect(pages.where(OWNER)).toBeNull()
    expect(pages.state(OWNER)).toBeNull()
  })

  it('keep what main said of a page since over what the window asked as it opened', async () => {
    const fake = fakePages()
    let answer: (states: ReadonlyArray<PageState>) => void = () => {}
    vi.mocked(fake.host.states).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderHook(() => usePage(OWNER, fake.host))
    fake.say(stateOf({ address: 'http://localhost:5173/now' }))
    await act(async () => answer([stateOf({ address: 'http://localhost:5173/before' })]))
    expect(pages.state(OWNER)?.address).toBe('http://localhost:5173/now')
  })

  it('show again where they were in a window reloaded or opened after them, each main still has', async () => {
    pages.place(OWNER, 'beside')
    pages.place('task_b', 'tab', { kind: 'task', threadId: 'thr_b', draft: 'task:thr_b' })
    pages.place('proj_c', 'tab', { kind: 'project', projectId: 'proj_c', draft: 'coordinator:proj_c' })
    // The window reloads: nothing of it stays but what its storage kept.
    forgetPages()
    const fake = fakePages()
    let answer: (states: ReadonlyArray<PageState>) => void = () => {}
    vi.mocked(fake.host.states).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderHook(() => usePage(OWNER, fake.host))
    // Where each came from is there at once, for a tab's address to open; where each shows waits for main's word.
    expect(pages.originOf('task_b')).toEqual({ kind: 'task', threadId: 'thr_b', draft: 'task:thr_b' })
    expect(pages.where(OWNER)).toBeNull()
    expect(pages.waking('task_b')).toBe(true)
    // Main still has two: the project's closed as Althar quit.
    await act(async () => answer([stateOf(), stateOf({ owner: 'task_b' })]))
    expect(pages.where(OWNER)).toBe('beside')
    expect(pages.tabs()).toEqual(['task_b'])
    expect(pages.waking('task_b')).toBe(false)
    expect(storedFrom(window.localStorage.getItem('althar.pages'))).toEqual({
      placed: [
        [OWNER, 'beside'],
        ['task_b', 'tab'],
      ],
      origins: { task_b: { kind: 'task', threadId: 'thr_b', draft: 'task:thr_b' } },
    })
  })

  it('stay where the person placed or hid them while main was asked, and show nowhere where main can’t say', async () => {
    pages.place(OWNER, 'tab', { kind: 'task', threadId: 'thr_1', draft: DRAFT })
    pages.place('task_b', 'beside')
    forgetPages()
    const fake = fakePages()
    let answer: (states: ReadonlyArray<PageState>) => void = () => {}
    vi.mocked(fake.host.states).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const before = renderHook(() => usePage(OWNER, fake.host))
    act(() => pages.place(OWNER, 'beside'))
    await act(async () => answer([stateOf(), stateOf({ owner: 'task_b' })]))
    expect(pages.where(OWNER)).toBe('beside')
    expect(pages.tabs()).toEqual([])

    // A window has one main to hear: the one before goes as the window reloads.
    before.unmount()
    forgetPages()
    const failing = fakePages()
    vi.mocked(failing.host.states).mockRejectedValue(new Error('No main'))
    renderHook(() => usePage(OWNER, failing.host))
    await waitFor(() => expect(pages.waking(OWNER)).toBe(false))
    expect(pages.where(OWNER)).toBeNull()
    expect(pages.where('task_b')).toBeNull()
  })

  it('take up only what reads as it should from the window’s storage', () => {
    const none = { placed: [], origins: {} }
    expect(storedFrom(null)).toEqual(none)
    expect(storedFrom('{not json')).toEqual(none)
    expect(storedFrom('[]')).toEqual(none)
    const task = { kind: 'task', threadId: 'thr_a', draft: 'task:thr_a' }
    const project = { kind: 'project', projectId: 'proj_c', draft: 'coordinator:proj_c' }
    const raw = JSON.stringify({
      placed: [['task_a', 'tab'], ['task_b', 'floating'], [3, 'beside'], 'proj_c', ['proj_c', 'beside']],
      origins: { task_a: task, task_b: { kind: 'task', draft: 'x' }, proj_c: project, task_d: null },
    })
    expect(storedFrom(raw)).toEqual({
      placed: [
        ['task_a', 'tab'],
        ['proj_c', 'beside'],
      ],
      origins: { task_a: task, proj_c: project },
    })
  })

  it('hand a comment to open again to the page that takes it, once', () => {
    pages.reopen('task_a', 'c1')
    expect(pages.reopenWaiting('task_a')).toBe('c1')
    expect(pages.takeReopen('task_a')).toBe('c1')
    expect(pages.takeReopen('task_a')).toBeNull()
  })
})

describe('a page’s tab, the window reloaded on it', () => {
  /** The app's window on a page's tab, as it reloads: its storage kept the tab, and main answers when the test says. */
  const reloadedOn = () => {
    window.localStorage.setItem(
      'althar.pages',
      JSON.stringify({ placed: [[OWNER, 'tab']], origins: { [OWNER]: { kind: 'task', threadId: 'thr_1', draft: DRAFT } } }),
    )
    const fake = fakePages()
    let answer: (states: ReadonlyArray<PageState>) => void = () => {}
    vi.mocked(fake.host.states).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { client } = fakeClient()
    const services = servicesFor(client, fakeHost({ pages: fake.host }))
    const thread = createRoute({ getParentRoute: () => rootRoute, path: '/threads/$threadId', component: () => <p>The thread</p> })
    const router = createRouter({
      routeTree: rootRoute.addChildren([pageRoute, thread]),
      history: createMemoryHistory({ initialEntries: [`/pages/${OWNER}`] }),
      context: { client, cache: services.cache },
    })
    render(
      <ServicesProvider value={services}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    )
    return { router, answer: (states: ReadonlyArray<PageState>) => act(async () => answer(states)) }
  }

  it('shows the page again in its tab once main says it still has it, going nowhere meanwhile', async () => {
    const { router, answer } = reloadedOn()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pages/${OWNER}`))
    expect(screen.queryByRole('complementary', { name: 'Page' })).toBeNull()
    await answer([stateOf({ title: 'Refunds' })])
    expect(await screen.findByRole('complementary', { name: 'Page' })).toBeTruthy()
    expect(router.state.location.pathname).toBe(`/pages/${OWNER}`)
  })

  it('goes back to the conversation it came from where main no longer has it', async () => {
    const { router, answer } = reloadedOn()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pages/${OWNER}`))
    await answer([])
    await waitFor(() => expect(router.state.location.pathname).toBe('/threads/thr_1'))
    expect(screen.queryByRole('complementary', { name: 'Page' })).toBeNull()
  })
})

describe('what is over the page', () => {
  const place = { x: 640, y: 120, width: 640, height: 700 }
  const drawnAt = (element: HTMLElement, x: number, y: number) =>
    vi
      .spyOn(element, 'getBoundingClientRect')
      .mockReturnValue({ x, y, width: 200, height: 100, left: x, top: y, right: x + 200, bottom: y + 100 } as DOMRect)

  it('is a popover, a menu, a tooltip or a dialog drawn over its place, not the app itself nor an empty container a portal left', () => {
    const root = document.createElement('div')
    const empty = document.createElement('div')
    vi.spyOn(empty, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 1280,
      height: 840,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 840,
    } as DOMRect)
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    document.body.append(root, empty, wrapper)
    drawnAt(root, 700, 200)
    drawnAt(wrapper, 100, 100)
    expect(coveredNow(root, place)).toBe(false)
    drawnAt(wrapper, 700, 300)
    expect(coveredNow(root, place)).toBe(true)
    wrapper.remove()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    empty.append(dialog)
    drawnAt(dialog, 800, 400)
    expect(coveredNow(root, place)).toBe(true)
    root.remove()
    empty.remove()
  })
})
