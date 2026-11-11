import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type CanvasCommentFacts, type CanvasDetail, type CanvasVersionFacts } from '@althar/contracts'

import { pictureUrl } from '../src/main/pictureAddress'
import type { CanvasesHost } from '../src/renderer/data/services'
import { byWords, CanvasHost, commentsShown, type OpenCanvas, shownVersion, svgAddress } from '../src/renderer/features/canvases/CanvasHost'
import { commentsOf, forgetComments } from '../src/renderer/shared/comments'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

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

const show = (
  client: ReturnType<typeof fakeClient>['client'],
  { open = latest, draft = DRAFT, canvases }: { open?: OpenCanvas; draft?: string | null; canvases?: CanvasesHost } = {},
) => {
  const onVersion = vi.fn()
  const onClose = vi.fn()
  const view = withServices(
    <CanvasHost threadId={THREAD} open={open} draft={draft} onVersion={onVersion} onClose={onClose} />,
    client,
    fakeHost(canvases === undefined ? {} : { canvases }),
  )
  return { ...view, onVersion, onClose }
}

describe('who published a version', () => {
  const now = new Date('2026-09-29T12:04:00.000Z')

  it('is the lead of its task, or the coordinator, and when', () => {
    expect(byWords(version(1), now)).toBe('The lead of Redesign sign-in · 4m ago')
    expect(byWords(version(1, { by: { role: 'coordinator', taskId: null, taskTitle: null } }), now)).toBe('The coordinator · 4m ago')
  })

  it('is a task’s lead where the task has no title, and leaves out a time it can’t read', () => {
    expect(byWords(version(1, { by: { role: 'lead', taskId: 'task_1', taskTitle: null }, at: 'not a time' }), now)).toBe(
      'The lead of a task',
    )
  })
})

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
      { id: 'cc_2', version: 2, body: 'Say Sign in', place: '“Continue”', answered: false, answer: null },
      { id: 'cc_1', version: 1, body: 'Make it shorter', place: 'Whole canvas', answered: true, answer: 'Cut it to one screen' },
    ])
  })
})

describe('a document beside the conversation', () => {
  it('shows its words, its name, who published it and the comments sent on it', async () => {
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
    expect(within(panel).getByText('sign-in-flow')).toBeTruthy()
    expect(within(panel).getByText(/Document · The lead of Redesign sign-in/)).toBeTruthy()
    expect(within(panel).getByText('Shorter errors')).toBeTruthy()
    expect(within(panel).getByText('v2')).toBeTruthy()
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

  it('step with its buttons, and say where a newer one is out while an older one shows', async () => {
    const { client } = canvasClient(held)
    const { onVersion } = show(client, { open: { canvasId: CANVAS, version: 2, follow: false } })
    const panel = await screen.findByRole('complementary', { name: 'Sign-in flow' })
    expect(within(panel).getByText('v2 of 3')).toBeTruthy()
    expect(within(panel).getByText('v3 is out')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: /Older version/ }))
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
    expect(within(panel).getByText(/Diagram · /)).toBeTruthy()
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

  const views = (): CanvasesHost => ({ show: vi.fn(), close: vi.fn(), reload: vi.fn() })

  it('is laid over the panel’s place at its version, moved as the place does, and loaded again when asked', async () => {
    let place = box(640, 120, 640, 700)
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => place)
    const canvases = views()
    const { client } = canvasClient(page())
    const { unmount } = show(client, { canvases })
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

  it('has nowhere to be laid, and nothing to load again, in a window without canvas views', async () => {
    const { client } = canvasClient(page())
    show(client)
    await waitFor(() => expect(document.querySelector(`[data-canvas-page="${CANVAS}"]`)).not.toBeNull())
    expect(screen.queryByRole('button', { name: /Load again/ })).toBeNull()
  })
})
