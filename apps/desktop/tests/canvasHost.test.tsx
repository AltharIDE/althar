import { type ComponentProps, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type CanvasCommentFacts, type CanvasDetail, type CanvasVersionFacts } from '@althar/contracts'

import { pictureUrl } from '../src/main/pictureAddress'
import type { CanvasesHost } from '../src/renderer/data/services'
import { CanvasHost, commentsShown, type OpenCanvas, shownVersion, svgAddress } from '../src/renderer/features/canvases/CanvasHost'
import { commentsOf, forgetComments } from '../src/renderer/shared/comments'
import { fakeClient, fakeHost } from './fixtures'
import { servicesFor, withServices } from './render'
import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'

/*
 * One of the project's canvases beside a conversation (ADR-104), as the
 * window draws it: a document's words, a diagram's source, a drawing or a
 * picture as an image, a page laid over the panel's place by the main
 * process; its versions a step apart; the comments sent on it; and a new
 * comment waiting in the conversation's draft, on the version and the words
 * it is on.
 */

const CANVAS = `cnv_${'c3'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`
const THREAD = `thr_${'a1'.repeat(16)}`
const DRAFT = `project:${THREAD}`

afterEach(() => {
  forgetComments()
  window.getSelection()?.removeAllRanges()
})

const version = (number: number, over: Partial<CanvasVersionFacts> = {}): CanvasVersionFacts => ({
  number,
  base: number === 1 ? null : number - 1,
  title: 'Sign-in flow',
  kind: 'markdown',
  entry: 'README.md',
  manifest: `${number}`.repeat(64),
  entrySha256: 'e'.repeat(64),
  note: null,
  files: 1,
  bytes: 120,
  by: { role: 'lead', taskId: 'task_1', taskTitle: 'Redesign sign-in' },
  at: '2026-09-29T12:00:00.000Z',
  ...over,
})

const detail = (versions: ReadonlyArray<CanvasVersionFacts>, comments: ReadonlyArray<CanvasCommentFacts> = []): CanvasDetail => ({
  summary: {
    id: CANVAS,
    projectId: PROJECT,
    name: 'sign-in-flow',
    group: null,
    latest: versions.at(-1) ?? version(1),
    versions: versions.length,
    openComments: comments.filter((one) => one.resolved === null).length,
    archived: false,
  },
  versions,
  comments,
})

const DOCUMENT = '# Sign in\n\nThe button says Continue.\n\n## Errors\n\nSay what went wrong, and how to put it right.\n'

/** A canvas the runtime holds, with its entry's words. */
const canvasClient = (held: CanvasDetail, words = DOCUMENT) =>
  fakeClient({
    getCanvas: vi.fn(async () => held),
    readCanvasText: vi.fn(async () => ({ path: 'README.md', text: words, bytes: words.length })),
  })

const latest: OpenCanvas = { canvasId: CANVAS, version: null, follow: true }

/** A canvas in an artifact's room: its versions and actions in the room's row, outside the panel. */
function InRoom(props: Omit<ComponentProps<typeof CanvasHost>, 'actionsIn'>) {
  const [row, setRow] = useState<HTMLSpanElement | null>(null)
  return (
    <>
      <span ref={setRow} role="toolbar" aria-label="The artifact’s row" />
      <CanvasHost {...props} actionsIn={row} />
    </>
  )
}

const show = (
  client: ReturnType<typeof fakeClient>['client'],
  {
    open = latest,
    draft = DRAFT,
    canvases,
    room = false,
  }: { open?: OpenCanvas; draft?: string | null; canvases?: CanvasesHost; room?: boolean } = {},
) => {
  const onVersion = vi.fn()
  const onClose = vi.fn()
  const Host = room ? InRoom : CanvasHost
  const view = withServices(
    <Host threadId={THREAD} open={open} draft={draft} onVersion={onVersion} onClose={onClose} />,
    client,
    fakeHost(canvases === undefined ? {} : { canvases }),
  )
  return { ...view, onVersion, onClose }
}

describe('the version shown', () => {
  const held = detail([version(1), version(2), version(3)])

  it('is the latest where the canvas follows it or names none, and the one named otherwise', () => {
    expect(shownVersion(held, { canvasId: CANVAS, version: 1, follow: true })?.number).toBe(3)
    expect(shownVersion(held, { canvasId: CANVAS, version: null, follow: false })?.number).toBe(3)
    expect(shownVersion(held, { canvasId: CANVAS, version: 2, follow: false })?.number).toBe(2)
  })

  it('is the latest where the canvas no longer has the one named, and none where it has no versions', () => {
    expect(shownVersion(held, { canvasId: CANVAS, version: 9, follow: false })?.number).toBe(3)
    expect(shownVersion(detail([]), latest)).toBeNull()
  })
})

describe('an SVG as a picture', () => {
  it('is its own words, read back whole, however large and in whatever letters', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>Café ✓</text>${'<rect width="1" height="1"/>'.repeat(3000)}</svg>`
    const address = svgAddress(svg)
    expect(address.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const bytes = Uint8Array.from(atob(address.slice('data:image/svg+xml;base64,'.length)), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe(svg)
  })
})

describe('the comments sent on a canvas', () => {
  it('list the open ones first, each with where it points and what the agent answered', () => {
    const held = detail(
      [version(1), version(2)],
      [
        {
          id: 'cc_1',
          version: 1,
          anchor: { kind: 'whole' },
          body: 'Make it shorter',
          at: '2026-09-29T11:00:00.000Z',
          resolved: { byVersion: 2, note: 'Cut it to one screen', at: '2026-09-29T11:30:00.000Z' },
        },
        {
          id: 'cc_2',
          version: 2,
          anchor: { kind: 'passage', text: 'Continue', heading: 'Sign in' },
          body: 'Say Sign in',
          at: '2026-09-29T11:40:00.000Z',
          resolved: null,
        },
      ],
    )
    expect(commentsShown(held)).toEqual([
      {
        id: 'cc_2',
        version: 2,
        body: 'Say Sign in',
        place: '“Continue”',
        answered: false,
        answer: null,
        anchor: { kind: 'passage', text: 'Continue', heading: 'Sign in' },
      },
      {
        id: 'cc_1',
        version: 1,
        body: 'Make it shorter',
        place: 'Whole canvas',
        answered: true,
        answer: 'Cut it to one screen',
        anchor: { kind: 'whole' },
      },
    ])
  })
})

describe('a document beside the conversation', () => {
  it('shows its words, its name, a way to the artifact and the comments sent on it', async () => {
    const { client } = canvasClient(
      detail(
        [version(1), version(2, { note: 'Shorter errors' })],
        [
          {
            id: 'cc_1',
            version: 1,
            anchor: { kind: 'whole' },
            body: 'Make it shorter',
            at: '2026-09-29T11:00:00.000Z',
            resolved: { byVersion: 2, note: 'Cut it to one screen', at: '2026-09-29T11:30:00.000Z' },
          },
        ],
      ),
    )
    show(client)
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    expect(await within(panel).findByRole('heading', { name: 'Errors' })).toBeTruthy()
    // Beside a conversation it is what it is, with a way to the artifact itself, where its versions are.
    expect(within(panel).getByRole('button', { name: 'Open Sign-in flow' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: /Older version/ })).toBeNull()
    const sent = within(panel).getByRole('list', { name: '1 comment' })
    expect(within(sent).getByText('Make it shorter')).toBeTruthy()
    expect(within(sent).getByText('Whole canvas · on v1 · Answered')).toBeTruthy()
    expect(within(sent).getByText('Cut it to one screen')).toBeTruthy()
    expect(client.readCanvasText).toHaveBeenCalledWith(CANVAS, 2)
  })

  it('says why its words couldn’t be read', async () => {
    const { client } = fakeClient({
      getCanvas: vi.fn(async () => detail([version(1)])),
      readCanvasText: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: 'The file is gone' })
      }),
    })
    show(client)
    expect(await screen.findByText(/Althar couldn’t read this canvas\..*The file is gone/)).toBeTruthy()
  })

  it('says why the canvas itself couldn’t be read, rather than waiting for its words', async () => {
    const { client } = fakeClient({
      getCanvas: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: 'The canvas is gone' })
      }),
    })
    show(client)
    expect(await screen.findByText(/The canvas is gone/)).toBeTruthy()
  })
})

describe('a canvas’s versions', () => {
  const held = detail([version(1), version(2), version(3)])

  it('step with their buttons in the artifact’s room, and say where a newer one is out while an older one shows', async () => {
    const { client } = canvasClient(held)
    const { onVersion } = show(client, { open: { canvasId: CANVAS, version: 2, follow: false }, room: true })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    const row = screen.getByRole('toolbar', { name: 'The artifact’s row' })
    expect(await within(row).findByText('v2 of 3')).toBeTruthy()
    expect(within(panel).getByText('v3 is out')).toBeTruthy()
    await userEvent.click(within(row).getByRole('button', { name: /Older version/ }))
    expect(onVersion).toHaveBeenLastCalledWith(1)
    await userEvent.click(within(panel).getByRole('button', { name: 'Show' }))
    expect(onVersion).toHaveBeenLastCalledWith(3)
  })

  it('step with [ and ] from the panel, but not from a field, with a modifier, or from outside it', async () => {
    const { client } = canvasClient(held)
    const { onVersion } = show(client, { open: { canvasId: CANVAS, version: 2, follow: false } })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    await within(panel).findByRole('heading', { name: 'Errors' })
    const close = within(panel).getByRole('button', { name: /Close/ })
    fireEvent.keyDown(close, { key: '[' })
    expect(onVersion).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(close, { key: ']' })
    expect(onVersion).toHaveBeenLastCalledWith(3)
    onVersion.mockClear()

    fireEvent.keyDown(close, { key: '[', metaKey: true })
    fireEvent.keyDown(close, { key: ']', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '[' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    fireEvent.keyDown(within(panel).getByRole('textbox'), { key: '[' })
    expect(onVersion).not.toHaveBeenCalled()
  })

  it('go no further than the first and the latest', async () => {
    const first = canvasClient(held)
    const shown = show(first.client, { open: { canvasId: CANVAS, version: 1, follow: false } })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    await within(panel).findByRole('heading', { name: 'Errors' })
    fireEvent.keyDown(within(panel).getByRole('button', { name: /Close/ }), { key: '[' })
    expect(shown.onVersion).not.toHaveBeenCalled()
    shown.unmount()

    const last = canvasClient(held)
    const following = show(last.client)
    const again = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    await within(again).findByRole('heading', { name: 'Errors' })
    expect(within(again).queryByText('v3 is out')).toBeNull()
    fireEvent.keyDown(within(again).getByRole('button', { name: /Close/ }), { key: ']' })
    expect(following.onVersion).not.toHaveBeenCalled()
  })
})

/** Selects the words of an element's text, as the person would with the pointer, and tells the window so. */
const select = (node: Node, from = 0, to = node.textContent?.length ?? 0) => {
  const range = document.createRange()
  const text = node.firstChild ?? node
  range.setStart(text, from)
  range.setEnd(text, to)
  const selection = window.getSelection()
  act(() => {
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

describe('a comment on a canvas', () => {
  it('on the whole of it waits in the conversation’s draft, on the version shown', async () => {
    const { client } = canvasClient(detail([version(1), version(2)]))
    show(client, { open: { canvasId: CANVAS, version: 1, follow: false } })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    await within(panel).findByRole('heading', { name: 'Errors' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    await userEvent.type(within(panel).getByPlaceholderText('Comment on v1'), 'Make the errors friendlier')
    await userEvent.click(within(panel).getByRole('button', { name: 'Add to message' }))
    expect(commentsOf(DRAFT)).toEqual([
      expect.objectContaining({
        note: 'Make the errors friendlier',
        on: { kind: 'canvas', canvasId: CANVAS, name: 'sign-in-flow', title: 'Sign-in flow', version: 1, anchor: { kind: 'whole' } },
        crop: null,
      }),
    ])
  })

  it('on words selected in a document is on those words and the heading they are under', async () => {
    const { client } = canvasClient(detail([version(1)]))
    show(client)
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    const words = await within(panel).findByText('Say what went wrong, and how to put it right.')
    select(words, 0, 'Say what went wrong'.length)
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    await userEvent.type(within(panel).getByPlaceholderText('Comment on “Say what went wrong”'), 'Say what to do next')
    await userEvent.click(within(panel).getByRole('button', { name: 'Add to message' }))
    expect(commentsOf(DRAFT).map((one) => one.on)).toEqual([
      expect.objectContaining({ version: 1, anchor: { kind: 'passage', text: 'Say what went wrong', heading: 'Errors' } }),
    ])
  })

  it('on a long passage is on its first words, and on words under no heading has none', async () => {
    const long = `${'Every field says what it wants. '.repeat(12).trim()}`
    const { client } = canvasClient(detail([version(1)]), `${long}\n\n# After\n\nMore.\n`)
    show(client)
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    select(await within(panel).findByText(long))
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    await userEvent.type(within(panel).getByRole('textbox'), 'Too long')
    await userEvent.click(within(panel).getByRole('button', { name: 'Add to message' }))
    const [made] = commentsOf(DRAFT)
    expect(made?.on).toMatchObject({ anchor: { kind: 'passage', heading: null } })
    const anchor = made?.on.kind === 'canvas' ? made.on.anchor : null
    expect(anchor?.kind === 'passage' ? anchor.text : '').toBe(`${long.slice(0, 239)}…`)
  })

  it('is on the whole canvas where nothing in it is selected: words outside it, or none', async () => {
    const outside = document.createElement('p')
    outside.textContent = 'Words in the conversation'
    document.body.append(outside)
    const { client } = canvasClient(detail([version(1)]))
    show(client)
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    const words = await within(panel).findByText('The button says Continue.')
    select(outside)
    select(words, 3, 3)
    select(words, 3, 4)
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    expect(within(panel).getByPlaceholderText('Comment on v1')).toBeTruthy()
    outside.remove()
  })

  it('can’t be made where the conversation has no draft', async () => {
    const { client } = canvasClient(detail([version(1)]))
    show(client, { draft: null })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    await within(panel).findByRole('heading', { name: 'Errors' })
    expect(within(panel).queryByRole('button', { name: 'Comment' })).toBeNull()
  })
})

describe('a canvas of another kind', () => {
  it('draws a diagram from its source', async () => {
    const { client } = canvasClient(detail([version(1, { kind: 'mermaid', title: 'The flow' })]), 'graph TD\n  A --> B')
    show(client)
    const panel = await screen.findByRole('complementary', { name: 'The flow' })
    expect(await within(panel).findByText(/A --> B/)).toBeTruthy()
  })

  it('draws an SVG as a picture of it, so nothing in it runs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const { client } = canvasClient(detail([version(1, { kind: 'svg', title: 'The mark' })]), svg)
    show(client)
    const picture = await screen.findByRole('img', { name: 'The mark' })
    expect(picture.getAttribute('src')).toBe(svgAddress(svg))
    expect(document.querySelector('script')).toBeNull()
  })

  it('draws a picture from the store, without reading words of it', async () => {
    const { client } = canvasClient(detail([version(1, { kind: 'picture', title: 'The shot', entrySha256: 'f'.repeat(64) })]))
    show(client)
    const picture = await screen.findByRole('img', { name: 'The shot' })
    expect(picture.getAttribute('src')).toBe(pictureUrl('f'.repeat(64)))
    expect(client.readCanvasText).not.toHaveBeenCalled()
  })
})

describe('a page canvas', () => {
  const box = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect

  const page = () => detail([version(1, { kind: 'html', title: 'Sign-in page', entry: 'index.html' })])

  // Whatever a test leaves over the window must not cover the next one's canvas, as repeated runs would have it.
  afterEach(() => {
    for (const left of document.body.querySelectorAll(':scope > [role="dialog"]')) left.remove()
    vi.restoreAllMocks()
  })

  const views = (): CanvasesHost => ({
    show: vi.fn(),
    close: vi.fn(),
    reload: vi.fn(),
    still: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
    cover: vi.fn(async () => {}),
    download: vi.fn(async () => ({ kind: 'cancelled' as const })),
  })

  it('beside a conversation, has its chip drawn in its own view, whose Open, Comment and close are the panel’s', async () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box(640, 120, 640, 700))
    let listen: ((threadId: string, news: never) => void) | null = null
    const canvases: CanvasesHost = {
      ...views(),
      chip: vi.fn(),
      onGround: (listener) => {
        listen = listener as never
        return () => (listen = null)
      },
    }
    const { client } = canvasClient(page())
    const { onClose } = show(client, { canvases })
    // Told its name, and that the conversation has a draft to keep a comment on all of it in.
    await waitFor(() => expect(canvases.chip).toHaveBeenLastCalledWith(THREAD, { title: 'Sign-in page', comment: true }))
    expect(screen.queryByRole('button', { name: 'Open Sign-in page' })).toBeNull()
    // Comment pressed on it opens the comment on all of it, which goes to the conversation's draft.
    act(() => listen?.(THREAD, { kind: 'key', key: 'comment' } as never))
    const field = await screen.findByRole('textbox')
    await userEvent.type(field, 'Calmer{Enter}')
    expect(commentsOf(DRAFT)).toMatchObject([{ note: 'Calmer', on: { kind: 'canvas', canvasId: CANVAS, version: 1 } }])
    act(() => listen?.(THREAD, { kind: 'key', key: 'close' } as never))
    expect(onClose).toHaveBeenCalled()
    measured.mockRestore()
  })

  it('is laid over the panel’s place at its version, moved as the place does, and loaded again when asked', async () => {
    let place = box(640, 120, 640, 700)
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => place)
    const canvases = views()
    const { client } = canvasClient(page())
    // In its room, where loading it again is the artifact's.
    const { unmount } = show(client, { canvases, room: true })
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 1, manifest: '1'.repeat(64) }
    await waitFor(() => expect(canvases.show).toHaveBeenLastCalledWith(THREAD, target, { x: 640, y: 120, width: 640, height: 700 }))
    expect(document.querySelector(`[data-canvas-page="${CANVAS}"]`)).not.toBeNull()
    expect(client.readCanvasText).not.toHaveBeenCalled()

    // The same place again sends nothing new; a new one moves it; a place with no room takes it off.
    const shown = vi.mocked(canvases.show).mock.calls.length
    act(() => void window.dispatchEvent(new Event('resize')))
    expect(canvases.show).toHaveBeenCalledTimes(shown)
    place = box(600, 120, 680, 700)
    act(() => void document.dispatchEvent(new Event('transitionend')))
    await waitFor(() => expect(canvases.show).toHaveBeenLastCalledWith(THREAD, target, { x: 600, y: 120, width: 680, height: 700 }))
    place = box(600, 120, 0, 0)
    act(() => void document.dispatchEvent(new Event('animationend')))
    await waitFor(() => expect(canvases.show).toHaveBeenLastCalledWith(THREAD, target, null))

    await userEvent.click(screen.getByRole('button', { name: /Load again/ }))
    expect(canvases.reload).toHaveBeenCalledWith(THREAD)

    unmount()
    expect(canvases.close).toHaveBeenCalledWith(THREAD)
    measured.mockRestore()
  })

  it('steps aside for what opens over its place, with a picture of it there, and comes back as it closes', async () => {
    const place = box(640, 120, 640, 700)
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => place)
    const canvases = views()
    const { client } = canvasClient(page())
    const { unmount } = show(client, { canvases })
    await waitFor(() => expect(canvases.show).toHaveBeenCalled())
    expect(canvases.cover).not.toHaveBeenCalledWith(THREAD, true)

    // A lightbox, as a Radix dialog at the end of the body, over the place.
    const lightbox = document.createElement('div')
    lightbox.setAttribute('role', 'dialog')
    act(() => document.body.append(lightbox))
    await waitFor(() => expect(canvases.still).toHaveBeenCalledWith(THREAD))
    const picture = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>('img[src="data:image/jpeg;base64,BBBB"]')
      if (found === null) throw new Error('No picture yet.')
      return found
    })
    // The view steps aside once the picture is drawn, not before.
    expect(canvases.cover).not.toHaveBeenCalledWith(THREAD, true)
    fireEvent.load(picture)
    expect(canvases.cover).toHaveBeenCalledWith(THREAD, true)

    act(() => lightbox.remove())
    await waitFor(() => expect(canvases.cover).toHaveBeenLastCalledWith(THREAD, false))
    await waitFor(() => expect(document.querySelector('img[src="data:image/jpeg;base64,BBBB"]')).toBeNull())

    // With no picture to give, the view steps aside all the same.
    vi.mocked(canvases.still).mockResolvedValueOnce(null)
    act(() => document.body.append(lightbox))
    await waitFor(() => expect(canvases.cover).toHaveBeenLastCalledWith(THREAD, true))

    unmount()
    expect(canvases.cover).toHaveBeenLastCalledWith(THREAD, false)
    lightbox.remove()
    measured.mockRestore()
  })

  it('has nowhere to be laid, and nothing to load again, in a window without canvas views', async () => {
    const { client } = canvasClient(page())
    show(client)
    await waitFor(() => expect(document.querySelector(`[data-canvas-page="${CANVAS}"]`)).not.toBeNull())
    expect(screen.queryByRole('button', { name: /Load again/ })).toBeNull()
  })
})

describe('a canvas of boards', () => {
  const box = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect
  const BOARDS = JSON.stringify({
    pages: [
      {
        name: 'Checkout',
        boards: [
          { name: 'Desktop', file: 'desktop.html', width: 1440, height: 900 },
          { name: 'Phone', file: 'phone.html', width: 390, height: 844 },
        ],
      },
      { name: 'Receipt', boards: [{ name: 'Desktop', file: 'receipt.html', width: 1440, height: 900 }] },
    ],
  })
  const held = (comments: ReadonlyArray<CanvasCommentFacts> = []) =>
    detail([version(1, { kind: 'boards', title: 'Checkout', entry: 'canvas.json' })], comments)

  afterEach(() => {
    for (const left of document.body.querySelectorAll(':scope > [role="dialog"], :scope > [role="menu"]')) left.remove()
    vi.restoreAllMocks()
  })

  /** A canvases host whose ground says what a test has it say. */
  const views = () => {
    let listen:
      | ((
          threadId: string,
          news: Parameters<NonNullable<CanvasesHost['onGround']>>[0] extends (t: string, n: infer N) => void ? N : never,
        ) => void)
      | null = null
    const canvases: CanvasesHost = {
      show: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      still: vi.fn(async () => null),
      cover: vi.fn(async () => {}),
      ground: vi.fn(),
      pins: vi.fn(async () => []),
      find: vi.fn(async () => null),
      clear: vi.fn(),
      onGround: (listener) => {
        listen = listener as never
        return () => (listen = null)
      },
    }
    return { canvases, say: (news: unknown) => act(() => listen?.(THREAD, news as never)) }
  }

  it('is drawn on Althar’s ground, its controls the ground’s own over the boards, and its keys work from the panel', async () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box(640, 120, 640, 700))
    const { canvases } = views()
    const { client } = canvasClient(held(), BOARDS)
    show(client, { canvases })
    const target = { projectId: PROJECT, canvasId: CANVAS, version: 1, manifest: '1'.repeat(64), boards: true }
    await waitFor(() => expect(canvases.show).toHaveBeenLastCalledWith(THREAD, target, { x: 640, y: 120, width: 640, height: 700 }))
    // The ground draws the pages, the view, the tools and the zoom over the boards: the panel has no bar of its own.
    expect(screen.queryByRole('toolbar', { name: 'Tools' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'One board at a time' })).toBeNull()

    // Its keys work from anywhere on the panel but a field: the tools and the zoom.
    const panel = screen.getByRole('complementary')
    for (const [key, change] of [
      ['h', { tool: 'hand' }],
      ['u', { tool: 'use' }],
      ['!', { zoom: 'fit' }],
      ['=', { zoom: 'in' }],
      ['-', { zoom: 'out' }],
    ] as const) {
      fireEvent.keyDown(panel, { key })
      expect(canvases.ground).toHaveBeenLastCalledWith(THREAD, change)
    }
    const calls = vi.mocked(canvases.ground!).mock.calls.length
    fireEvent.keyDown(panel, { key: 'h', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'h' })
    expect(vi.mocked(canvases.ground!).mock.calls.length).toBe(calls)
    measured.mockRestore()
  })

  it('files a part pointed at on the version it was pointed on, though a newer one is published while it is written', async () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box(640, 120, 640, 700))
    const { canvases, say } = views()
    const first = held()
    const { client } = canvasClient(first, BOARDS)
    const services = servicesFor(client, fakeHost({ canvases }))
    render(
      <ServicesProvider value={services}>
        <CanvasHost threadId={THREAD} open={latest} draft={DRAFT} onVersion={vi.fn()} onClose={vi.fn()} />
      </ServicesProvider>,
    )
    await waitFor(() => expect(canvases.show).toHaveBeenCalled())
    const picked = {
      selector: 'button.go',
      label: 'button.go',
      text: 'Send the gift',
      rect: { x: 10, y: 20, width: 120, height: 40 },
      font: '14px · 500 · Inter',
      colour: '#ffffff',
      background: '#c2552d',
      page: { width: 390, height: 844 },
    }
    say({
      kind: 'pointed',
      pointed: {
        canvasId: CANVAS,
        version: 1,
        page: 'Checkout',
        board: 'Phone',
        picked,
        crop: null,
        cropSize: null,
        still: 'data:image/jpeg;base64,CCCC',
        at: { x: 40, y: 60, width: 60, height: 20 },
      },
    })
    const field = await screen.findByRole('textbox', { name: 'Comment on button.go' })
    // Another agent publishes v2 while the comment is being written; the panel follows the latest.
    vi.mocked(client.getCanvas).mockImplementation(async () =>
      detail([
        version(1, { kind: 'boards', title: 'Checkout', entry: 'canvas.json' }),
        version(2, { kind: 'boards', title: 'Checkout, v2', entry: 'canvas.json' }),
      ]),
    )
    await act(async () => services.cache.invalidateQueries({ queryKey: keys.canvas(CANVAS) }))
    await waitFor(() => expect(vi.mocked(canvases.show).mock.calls.at(-1)?.[1]).toMatchObject({ version: 2 }))
    await userEvent.type(field, 'Say Send it{Enter}')
    expect(commentsOf(DRAFT)).toMatchObject([{ note: 'Say Send it', on: { kind: 'canvas', version: 1, title: 'Checkout' } }])
    measured.mockRestore()
  })

  it('files a part on the version the view had loaded as it was pointed at, and a draft’s pin opened on a newer one keeps its part', async () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box(640, 120, 640, 700))
    const { canvases, say } = views()
    const both = detail([
      version(1, { kind: 'boards', title: 'Checkout', entry: 'canvas.json' }),
      version(2, { kind: 'boards', title: 'Checkout, v2', entry: 'canvas.json' }),
    ])
    const { client } = canvasClient(both, BOARDS)
    render(
      <ServicesProvider value={servicesFor(client, fakeHost({ canvases }))}>
        <CanvasHost threadId={THREAD} open={latest} draft={DRAFT} onVersion={vi.fn()} onClose={vi.fn()} />
      </ServicesProvider>,
    )
    // The window has moved on to v2 by the time it hears of a part pointed at while the view had v1.
    await waitFor(() => expect(vi.mocked(canvases.show).mock.calls.at(-1)?.[1]).toMatchObject({ version: 2 }))
    const picked = {
      selector: 'button.go',
      label: 'button.go',
      text: 'Send the gift',
      rect: { x: 10, y: 20, width: 120, height: 40 },
      font: '14px · 500 · Inter',
      colour: '#ffffff',
      background: '#c2552d',
      page: { width: 390, height: 844 },
    }
    const pointed = (version: number, over: object = {}) => ({
      canvasId: CANVAS,
      version,
      page: 'Checkout',
      board: 'Phone',
      picked,
      crop: null,
      cropSize: null,
      still: 'data:image/jpeg;base64,CCCC',
      at: { x: 40, y: 60, width: 60, height: 20 },
      ...over,
    })
    // One from another canvas, the view having moved on to it, opens nothing.
    say({ kind: 'pointed', pointed: pointed(1, { canvasId: `cnv_${'f6'.repeat(16)}` }) })
    expect(screen.queryByRole('textbox', { name: 'Comment on button.go' })).toBeNull()
    expect(canvases.clear).toHaveBeenCalledWith(THREAD)
    say({ kind: 'pointed', pointed: pointed(1) })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Comment on button.go' }), 'Say Send it{Enter}')
    const anchor = { kind: 'element', selector: 'button.go', label: 'button.go', text: 'Send the gift', page: 'Checkout', board: 'Phone' }
    expect(commentsOf(DRAFT)).toMatchObject([{ note: 'Say Send it', crop: null, on: { version: 1, title: 'Checkout', anchor } }])

    // Its pin, pressed on v2, opens it where its part shows there; changed, it keeps the part and picture it was made on, on v1.
    vi.mocked(canvases.find!).mockResolvedValue(
      pointed(2, { picked: { ...picked, text: 'Send it now' }, crop: 'data:image/png;base64,TkVX', cropSize: { width: 10, height: 10 } }),
    )
    say({ kind: 'pin', n: 1 })
    const again = await screen.findByRole('textbox', { name: 'Comment on button.go' })
    await userEvent.clear(again)
    await userEvent.type(again, 'Say Send it now{Enter}')
    expect(commentsOf(DRAFT)).toMatchObject([{ note: 'Say Send it now', crop: null, on: { version: 1, title: 'Checkout', anchor } }])
    measured.mockRestore()
  })

  it('takes a part pointed at as a comment in the draft, on its board, with its pin', async () => {
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box(640, 120, 640, 700))
    const { canvases, say } = views()
    const sent: CanvasCommentFacts = {
      id: 'cc_1',
      version: 1,
      anchor: { kind: 'element', selector: 'h1', label: 'h1', text: 'Pay', page: 'Checkout', board: 'Desktop' },
      body: 'Bigger',
      at: '2026-09-29T11:00:00.000Z',
      resolved: null,
    }
    const { client } = canvasClient(held([sent]), BOARDS)
    show(client, { canvases })
    await waitFor(() =>
      expect(canvases.pins).toHaveBeenLastCalledWith(THREAD, [
        { n: 1, page: 'Checkout', board: 'Desktop', selector: 'h1', answered: false, draft: false },
      ]),
    )
    expect(screen.getByRole('button', { name: 'Pin 1' })).not.toBeNull()

    const picked = {
      selector: 'button.go',
      label: 'button.go',
      text: 'Send the gift',
      rect: { x: 10, y: 20, width: 120, height: 40 },
      font: '14px · 500 · Inter',
      colour: '#ffffff',
      background: '#c2552d',
      page: { width: 390, height: 844 },
    }
    say({
      kind: 'pointed',
      pointed: {
        canvasId: CANVAS,
        version: 1,
        page: 'Checkout',
        board: 'Phone',
        picked,
        crop: null,
        cropSize: null,
        still: 'data:image/jpeg;base64,CCCC',
        at: { x: 40, y: 60, width: 60, height: 20 },
      },
    })
    const field = await screen.findByRole('textbox', { name: 'Comment on button.go' })
    // The view steps aside for the picture taken as it was pointed at.
    fireEvent.load(document.querySelector<HTMLImageElement>('img[src="data:image/jpeg;base64,CCCC"]') as HTMLImageElement)
    expect(canvases.cover).toHaveBeenCalledWith(THREAD, true)
    await userEvent.type(field, 'Say Send it{Enter}')
    expect(commentsOf(DRAFT)).toMatchObject([
      {
        note: 'Say Send it',
        on: {
          kind: 'canvas',
          canvasId: CANVAS,
          version: 1,
          anchor: { kind: 'element', selector: 'button.go', label: 'button.go', text: 'Send the gift', page: 'Checkout', board: 'Phone' },
        },
      },
    ])
    expect(canvases.clear).toHaveBeenCalledWith(THREAD)
    await waitFor(() =>
      expect(canvases.pins).toHaveBeenLastCalledWith(THREAD, [
        { n: 1, page: 'Checkout', board: 'Desktop', selector: 'h1', answered: false, draft: false },
        { n: 2, page: 'Checkout', board: 'Phone', selector: 'button.go', answered: false, draft: true },
      ]),
    )
    // A version step pressed in the canvas steps the panel's.
    measured.mockRestore()
  })
})
