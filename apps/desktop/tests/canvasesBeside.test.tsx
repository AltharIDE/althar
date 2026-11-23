import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  type CanvasDetail,
  type CanvasKind,
  type CanvasSummary,
  type CanvasVersionFacts,
  type ThreadItem,
} from '@althar/contracts'
import { DocPanel, ThreadShellProvider, Room } from '@althar/ui'

import { ServicesProvider } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useProject } from '../src/renderer/features/project/useProject'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useTask } from '../src/renderer/features/task/useTask'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { keys } from '../src/renderer/data/reads'
import { arrived, useCanvasArrivals } from '../src/renderer/features/canvases/arrivals'
import { ArtifactsView, forgetArtifactsView, rowOf } from '../src/renderer/features/canvases/ArtifactsView'
import { useDraftCanvasVersions } from '../src/renderer/features/canvases/draftVersions'
import { askToOpen } from '../src/renderer/features/canvases/opening'
import { pages } from '../src/renderer/features/browser/pages'
import { type ThreadPage, useThreadHost } from '../src/renderer/shared/ThreadHost'
import { commentsOf, forgetComments, gather, type GatheredComment } from '../src/renderer/shared/comments'
import { agents, coordinatorSnapshot, snapshot, fakeClient, fakeHost, fakePagesHost, NOW } from './fixtures'
import { useSettingsOf, servicesFor, withServices } from './render'

/*
 * A project's canvases beside its conversations (ADR-104): one its agent
 * publishes or opens arrives on the conversation's workbench, following the
 * latest or at the version it named, and only what arrives while the person
 * is there; one the person opens from the thread takes the workbench from a
 * document, a file or a page, and gives it back; and the project's
 * Artifacts view lists them all, opens one in its place, and sends what is
 * said on it to the coordinator's conversation.
 */

const CANVAS = `cnv_${'c3'.repeat(16)}`
const OTHER = `cnv_${'d4'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`
const THREAD = `thr_${'a1'.repeat(16)}`
const OWNER = `task_${'e5'.repeat(16)}`
const DRAFT = `task:${THREAD}`

afterEach(() => {
  forgetComments()
  forgetArtifactsView()
})

const version = (number: number, over: Partial<CanvasVersionFacts> = {}): CanvasVersionFacts => ({
  number,
  base: number === 1 ? null : number - 1,
  title: `Sign-in flow, take ${number}`,
  kind: 'markdown',
  entry: 'README.md',
  manifest: `${number}`.repeat(64),
  entrySha256: 'e'.repeat(64),
  note: null,
  files: 1,
  bytes: 120,
  by: { role: 'lead', taskId: 'task_1', taskTitle: 'Redesign sign-in' },
  at: NOW,
  ...over,
})

const summary = (id: string, name: string, latest: CanvasVersionFacts, openComments = 0): CanvasSummary => ({
  id,
  projectId: PROJECT,
  name,
  group: null,
  latest,
  versions: latest.number,
  openComments,
  archived: false,
})

const held: CanvasDetail = {
  summary: summary(CANVAS, 'sign-in-flow', version(3)),
  versions: [version(1), version(2), version(3)],
  comments: [],
}

/** The runtime's canvas, each version's words saying which it is. */
const canvasClient = (overrides: Parameters<typeof fakeClient>[0] = {}) =>
  fakeClient({
    getCanvas: vi.fn(async () => held),
    readCanvasText: vi.fn(async (_canvasId: string, number: number) => {
      const text = `# Take ${number}\n\nThe form.\n`
      return { path: 'README.md', text, bytes: text.length }
    }),
    ...overrides,
  })

it('marks drafts on pruned or deleted canvas versions and preserves drafts when a read is unavailable', async () => {
  const unavailable = 'unavailable-canvas'
  const { client } = canvasClient({
    getCanvas: vi.fn(async (id) => {
      if (id === OTHER) throw new ApiError({ reason: 'NotFound', message: 'Canvas was removed' })
      if (id === unavailable) throw new ApiError({ reason: 'Unavailable', message: 'Could not reach the home' })
      return { ...held, versions: [version(2), version(3)] }
    }),
  })
  const draft = (id: string, canvasId: string, number: number): GatheredComment => ({
    id,
    crop: null,
    note: `Review ${id}`,
    on: {
      kind: 'canvas',
      canvasId,
      name: 'sign-in-flow',
      title: 'Sign-in flow',
      version: number,
      anchor: { kind: 'passage', text: 'Continue', heading: null },
    },
  })
  gather(DRAFT, draft('pruned', CANVAS, 1))
  gather(DRAFT, { ...draft('still there', CANVAS, 2), earlier: true })
  gather(DRAFT, draft('removed', OTHER, 2))
  gather(DRAFT, draft('unavailable', unavailable, 2))
  const drafts = commentsOf(DRAFT)
  const ReadDrafts = () => {
    useDraftCanvasVersions(DRAFT, drafts)
    return null
  }
  withServices(<ReadDrafts />, client)

  expect(commentsOf(DRAFT)).toBe(drafts)
  await waitFor(() =>
    expect(commentsOf(DRAFT).map((one) => [one.id, one.earlier])).toEqual([
      ['pruned', true],
      ['still there', false],
      ['removed', true],
      ['unavailable', undefined],
    ]),
  )
  expect(client.getCanvas).toHaveBeenCalledTimes(3)
})

let sequence = 0
/** A canvas item in the thread: a version its agent published, or opened beside its conversation. */
const canvasItem = (action: 'published' | 'opened', number: number, open = true, canvasId = CANVAS): ThreadItem => {
  sequence += 1
  return {
    id: `canvas_item_${sequence}`,
    sequence,
    createdAt: NOW,
    agentId: 'claude-code',
    kind: 'canvas',
    content: {
      canvasId,
      name: 'sign-in-flow',
      title: `Sign-in flow, take ${number}`,
      canvasKind: 'markdown' as CanvasKind,
      version: number,
      note: null,
      action,
      open,
    },
  } as ThreadItem
}

const panelOf = (title: string) => screen.findByRole('complementary', { name: title })

describe('the canvas items a thread hears of', () => {
  it('are those it hadn’t seen, the newest that asks to open opening', () => {
    const first = canvasItem('published', 1)
    const second = canvasItem('opened', 2)
    const quiet = canvasItem('published', 3, false)
    const { fresh, opens } = arrived([first, second, quiet], new Set([first.id]))
    expect(fresh.map((one) => one.id)).toEqual([second.id, quiet.id])
    expect(opens?.id).toBe(second.id)
    expect(arrived([quiet], new Set()).opens).toBeNull()
  })
})

/** A conversation with its workbench: what its thread holds, its document and its canvas, and its page where it has one. */
function Conversation({
  items,
  page = null,
  threadId = THREAD,
}: {
  items?: ReadonlyArray<ThreadItem>
  page?: ThreadPage | null
  threadId?: string | null
}) {
  const host = useThreadHost(true, { threadId, taskId: null }, page)
  useCanvasArrivals(items, host.openCanvas)
  return (
    <ThreadShellProvider value={host.shell}>
      <button type="button" onClick={() => host.shell.openDoc?.({ path: 'docs/plan.md', body: 'The plan.' })}>
        Read the plan
      </button>
      {host.shell.openCanvas !== undefined && (
        <button
          type="button"
          onClick={() =>
            host.shell.openCanvas?.({ canvasId: CANVAS, name: 'sign-in-flow', title: 'Sign-in flow', kind: 'markdown', version: 1 })
          }
        >
          Open the canvas at v1
        </button>
      )}
      <p>Opened: {host.shell.openedCanvas ?? 'none'}</p>
      <p>Canvas: {host.canvas === null ? 'none' : `${host.canvas.canvasId} at ${host.canvas.version ?? 'latest'}`}</p>
      {host.workbench(host.doc && <DocPanel doc={host.doc} onClose={host.closeDoc} />)}
    </ThreadShellProvider>
  )
}

describe('a canvas arriving in a conversation', () => {
  it('opens nothing the thread held as the window read it, nor before it was read', async () => {
    const { client } = canvasClient()
    const view = withServices(<Conversation />, client)
    view.rerender(
      <ServicesProvider value={servicesFor(client)}>
        <Conversation items={[canvasItem('published', 3)]} />
      </ServicesProvider>,
    )
    expect(screen.getByText('Canvas: none')).toBeTruthy()
    expect(client.getCanvas).not.toHaveBeenCalled()
  })

  it('opens a version published following the latest, one opened at its version, and nothing for one that didn’t ask', async () => {
    const { client } = canvasClient()
    const services = servicesFor(client)
    const at = (items: ReadonlyArray<ThreadItem>) => (
      <ServicesProvider value={services}>
        <Conversation items={items} />
      </ServicesProvider>
    )
    const before = [canvasItem('published', 1)]
    const view = render(at(before))

    const published = [...before, canvasItem('published', 3)]
    view.rerender(at(published))
    const latest = await panelOf('Sign-in flow, take 3')
    expect(await within(latest).findByRole('heading', { name: 'Take 3' })).toBeTruthy()
    expect(screen.getByText(`Canvas: ${CANVAS} at latest`)).toBeTruthy()

    const opened = [...published, canvasItem('opened', 2)]
    view.rerender(at(opened))
    const older = await panelOf('Sign-in flow, take 2')
    expect(within(older).getByText('v3 is out')).toBeTruthy()

    // One that doesn't ask to open leaves the canvas shown where it is; the same items again open nothing new.
    view.rerender(at([...opened, canvasItem('published', 3, false)]))
    view.rerender(at([...opened, canvasItem('published', 3, false)]))
    expect(screen.getByText(`Canvas: ${CANVAS} at 2`)).toBeTruthy()
  })
})

describe('a canvas opened from the thread', () => {
  it('opens at the version named, says a newer one is out and shows it, and closes', async () => {
    const { client } = canvasClient()
    withServices(<Conversation />, client)
    expect(screen.getByText('Opened: none')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open the canvas at v1' }))
    const panel = await panelOf('Sign-in flow, take 1')
    expect(screen.getByText(`Opened: ${CANVAS}`)).toBeTruthy()
    // Its versions step in the artifact itself; beside the conversation, a newer one is said, with Show.
    expect(within(panel).queryByRole('button', { name: /Newer version/ })).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Show' }))
    expect(await panelOf('Sign-in flow, take 3')).toBeTruthy()
    expect(screen.getByText(`Canvas: ${CANVAS} at 3`)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Close the panel' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    expect(screen.getByText('Canvas: none')).toBeTruthy()
  })

  it('takes the workbench from a document, and gives it to one opened after it', async () => {
    const { client } = canvasClient()
    withServices(<Conversation />, client)
    await userEvent.click(screen.getByRole('button', { name: 'Read the plan' }))
    expect(await panelOf('plan.md')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open the canvas at v1' }))
    await panelOf('Sign-in flow, take 1')
    expect(screen.queryByRole('complementary', { name: 'plan.md' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Read the plan' }))
    expect(await panelOf('plan.md')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Sign-in flow, take 1' })).toBeNull()
  })

  it('can’t be opened from a conversation with no thread', () => {
    const { client } = canvasClient()
    withServices(<Conversation threadId={null} />, client)
    expect(screen.queryByRole('button', { name: 'Open the canvas at v1' })).toBeNull()
  })
})

describe('a canvas and the conversation’s page', () => {
  const page: ThreadPage = {
    owner: OWNER,
    kind: 'task',
    draft: DRAFT,
    opener: { run: vi.fn(), link: vi.fn(), links: 'outside' },
    onDock: vi.fn(),
  }

  it('takes the page’s place beside the conversation, opened by its agent or from the thread, and gives it back', async () => {
    const { client } = canvasClient()
    const services = servicesFor(client, fakeHost({ pages: fakePagesHost() }))
    const at = (items: ReadonlyArray<ThreadItem>) => (
      <ServicesProvider value={services}>
        <Conversation items={items} page={page} />
      </ServicesProvider>
    )
    act(() => pages.place(OWNER, 'beside'))
    const view = render(at([]))
    await userEvent.click(screen.getByRole('button', { name: 'Open the canvas at v1' }))
    await panelOf('Sign-in flow, take 1')
    expect(pages.where(OWNER)).toBeNull()

    // The page beside again takes the canvas away.
    act(() => pages.place(OWNER, 'beside'))
    await waitFor(() => expect(screen.getByText('Canvas: none')).toBeTruthy())

    // Its agent publishes: the canvas takes the page's place again.
    view.rerender(at([canvasItem('published', 3)]))
    await panelOf('Sign-in flow, take 3')
    expect(pages.where(OWNER)).toBeNull()

    // A document opened takes the page's place as a canvas does.
    act(() => pages.place(OWNER, 'beside'))
    await waitFor(() => expect(screen.getByText('Canvas: none')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Read the plan' }))
    expect(await panelOf('plan.md')).toBeTruthy()
    expect(pages.where(OWNER)).toBeNull()
  })

  it('sends a comment made on it to the conversation’s draft', async () => {
    const { client } = canvasClient()
    withServices(<Conversation page={page} />, client, fakeHost({ pages: fakePagesHost() }))
    await userEvent.click(screen.getByRole('button', { name: 'Open the canvas at v1' }))
    const panel = await panelOf('Sign-in flow, take 1')
    await within(panel).findByRole('heading', { name: 'Take 1' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment' }))
    await userEvent.type(within(panel).getByRole('textbox'), 'Shorter')
    await userEvent.click(within(panel).getByRole('button', { name: 'Add to message' }))
    expect(commentsOf(DRAFT).map((one) => [one.note, one.on.kind])).toEqual([['Shorter', 'canvas']])
  })
})

describe('a canvas as the Artifacts view lists it', () => {
  it('says who made its latest version, and when', () => {
    const now = new Date('2026-09-29T14:00:00.000Z')
    expect(rowOf(summary(CANVAS, 'sign-in-flow', version(3), 2), now)).toEqual({
      id: CANVAS,
      name: 'sign-in-flow',
      title: 'Sign-in flow, take 3',
      kind: 'markdown',
      version: 3,
      by: 'Lead of Redesign sign-in',
      when: '2h ago',
      at: NOW,
      openComments: 2,
      picture: null,
      saved: null,
    })
    const coordinator = version(1, { by: { role: 'coordinator', taskId: null, taskTitle: null } })
    expect(rowOf(summary(OTHER, 'plan', coordinator), now).by).toBe('Coordinator')
    expect(rowOf(summary(OTHER, 'plan', version(1, { by: { role: 'lead', taskId: 'task_2', taskTitle: null } })), now).by).toBe(
      'Lead of a task',
    )
    expect(rowOf(summary(OTHER, 'plan', version(1, { by: { role: 'chat', taskId: 'task_3', taskTitle: null } })), now).by).toBe('Its chat')
  })

  it('shows a picture as itself, smaller', () => {
    const shot = rowOf(summary(OTHER, 'shot', version(1, { kind: 'picture', entry: 'shot.png' })))
    expect(shot.picture).toMatch(new RegExp(`/shot/${'e'.repeat(64)}\\?w=\\d+$`))
  })
})

describe('the project’s Artifacts view', () => {
  const listed = [
    summary(CANVAS, 'sign-in-flow', version(3)),
    summary(OTHER, 'plan', version(1, { title: 'The plan', by: { role: 'coordinator', taskId: null, taskTitle: null } })),
  ]
  const LEAD = { key: 'implement' as const, agentId: 'claude-code', model: 'opus', effort: null, skipped: false }
  const ARTIFACT_DRAFT = `artifact:${CANVAS}`

  it('opens one as itself, with its own chat beside it rather than a task, steps it, and goes back to the list', async () => {
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed) })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'List' }))
    const table = await screen.findByRole('table', { name: 'The project’s artifacts' })
    expect(within(table).getByText('Coordinator')).toBeTruthy()
    expect(within(table).getByText('Lead of Redesign sign-in')).toBeTruthy()
    expect(client.listCanvases).toHaveBeenCalledWith(PROJECT)

    await userEvent.click(within(table).getByRole('button', { name: 'Sign-in flow, take 3' }))
    const panel = await panelOf('Sign-in flow, take 3')
    expect(screen.queryByRole('table')).toBeNull()
    // Its one top row is the artifact's, in the project's place: its name, which opens every artifact, and who made it, then
    // its versions and actions; never a task's step. The panel has no head of its own.
    const chat = screen.getByRole('region', { name: 'Its chat' })
    expect(screen.getByRole('button', { name: /Sign-in flow, take 3/ })).toBeTruthy()
    expect(screen.getByText('Lead of Redesign sign-in')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Close the panel' })).toBeNull()
    expect(within(chat).getByPlaceholderText('Ask about it, or say what to change')).toBeTruthy()
    // Nothing starts for an artifact only looked at.
    expect(client.startTask).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Older version/ }))
    const older = await panelOf('Sign-in flow, take 2')
    expect(await within(older).findByRole('heading', { name: 'Take 2' })).toBeTruthy()

    // A comment on it is the artifact's, kept for its chat, which starts as the person means to talk.
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await userEvent.type(within(older).getByRole('textbox'), 'Keep this one')
    await userEvent.click(within(older).getByRole('button', { name: 'Add to message' }))
    expect(commentsOf(ARTIFACT_DRAFT).map((one) => (one.on.kind === 'canvas' ? one.on.version : null))).toEqual([2])
    await waitFor(() =>
      expect(client.startTask).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT, chat: true, artifact: { canvasId: CANVAS }, steps: [LEAD] }),
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back to Artifacts' }))
    expect(await screen.findByRole('table', { name: 'The project’s artifacts' })).toBeTruthy()
  })

  it('starts an artifact’s chat once, as the person goes to its composer, and one that has a chat starts none', async () => {
    const talked = { ...listed[1]!, chat: { taskId: 'task_chat', threadId: 'thr_chat' } }
    const { client } = canvasClient({ listCanvases: vi.fn(async () => [listed[0]!, talked]) })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    const cards = await screen.findByRole('list', { name: 'The project’s artifacts' })
    await userEvent.click(within(cards).getByRole('button', { name: /^Sign-in flow, take 3/ }))
    const field = await screen.findByPlaceholderText('Ask about it, or say what to change')
    await userEvent.click(field)
    await userEvent.click(field)
    await waitFor(() => expect(client.startTask).toHaveBeenCalledTimes(1))

    // Another artifact, by its name: one that has a chat opens it, and starts nothing.
    await userEvent.click(screen.getByRole('button', { name: /Sign-in flow, take 3/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'The plan' }))
    await waitFor(() => expect(client.getCanvas).toHaveBeenCalledWith(OTHER))
    await waitFor(() => expect(screen.queryByPlaceholderText('Ask about it, or say what to change')).toBeNull())
    expect(client.startTask).toHaveBeenCalledTimes(1)
  })

  it('shows its composer’s model picker before anything is written, and starts its chat with the model picked there', async () => {
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed) })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={{ ...LEAD, effort: 'high' }} agents={agents} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    const chat = await screen.findByRole('region', { name: 'Its chat' })
    expect(within(chat).getByRole('button', { name: 'Add files' })).toBeTruthy()
    // Opening the picker isn't talking: nothing starts until the person goes to the field or sends.
    await userEvent.click(await within(chat).findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    expect(client.startTask).not.toHaveBeenCalled()
    await userEvent.type(within(chat).getByPlaceholderText('Ask about it, or say what to change'), 'Calmer')
    await waitFor(() =>
      expect(client.startTask).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: [{ key: 'implement', agentId: 'claude-code', model: 'default', effort: 'high', skipped: false }],
        }),
      ),
    )
  })

  it('lets its chat’s edge be dragged wider or narrower, within limits, and keeps the width for the next artifact opened', async () => {
    window.localStorage.removeItem('althar.artifactChat')
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed) })
    const view = withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    const chat = await screen.findByRole('region', { name: 'Its chat' })
    const edge = within(chat).getByRole('separator', { name: 'Width of its chat' })
    expect(edge.getAttribute('aria-valuenow')).toBe('380')
    expect(edge.getAttribute('aria-valuemin')).toBe('300')
    // Dragged 120px to the right, it is that much wider.
    fireEvent.pointerDown(edge, { button: 0, clientX: 380, pointerId: 1 })
    fireEvent.pointerMove(edge, { clientX: 500, pointerId: 1 })
    fireEvent.pointerUp(edge, { clientX: 500, pointerId: 1 })
    expect(chat.style.getPropertyValue('--chat-width')).toBe('500px')
    expect(window.localStorage.getItem('althar.artifactChat')).toBe('500')
    // Never narrower than its least, and never so wide the artifact has no room.
    fireEvent.keyDown(edge, { key: 'Home' })
    expect(edge.getAttribute('aria-valuenow')).toBe('300')
    fireEvent.keyDown(edge, { key: 'End' })
    expect(Number(edge.getAttribute('aria-valuenow'))).toBe(window.innerWidth - 420)
    fireEvent.keyDown(edge, { key: 'ArrowLeft' })
    const kept = edge.getAttribute('aria-valuenow')
    // Opened again, it is as the person left it.
    view.unmount()
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^The plan/ }),
    )
    expect((await screen.findByRole('separator', { name: 'Width of its chat' })).getAttribute('aria-valuenow')).toBe(kept)
  })

  it('sends words written before its chat started to that artifact’s own chat, even after going to another', async () => {
    const talked = { ...listed[1]!, chat: { taskId: 'task_chat', threadId: 'thr_chat' } }
    let ready: (started: { id: string; threadId: string }) => void = () => {}
    const startTask = vi.fn(() => new Promise<never>((resolve) => (ready = resolve as never)))
    const { client } = canvasClient({ listCanvases: vi.fn(async () => [listed[0]!, talked]), startTask })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    const field = await screen.findByPlaceholderText('Ask about it, or say what to change')
    await userEvent.type(field, 'Make it calmer{Enter}')
    expect(startTask).toHaveBeenCalledTimes(1)
    // To another artifact, which has a chat of its own, before the first one's has started.
    await userEvent.click(screen.getByRole('button', { name: /Sign-in flow, take 3/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'The plan' }))
    await act(async () => ready({ id: 'task_new', threadId: 'thr_new' }))
    await waitFor(() => expect(client.send).toHaveBeenCalled())
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr_new', body: 'Make it calmer' }))
  })

  it('sends words written before its chat started even after leaving every artifact', async () => {
    let ready: (started: { id: string; threadId: string }) => void = () => {}
    const startTask = vi.fn(() => new Promise<never>((resolve) => (ready = resolve as never)))
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed), startTask })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    await userEvent.type(await screen.findByPlaceholderText('Ask about it, or say what to change'), 'Bigger photos{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Back to Artifacts' }))
    expect(await screen.findByRole('list', { name: 'The project’s artifacts' })).toBeTruthy()
    await act(async () => ready({ id: 'task_new', threadId: 'thr_new' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr_new', body: 'Bigger photos' })))
  })

  /** A comment on the whole of its latest version, kept in the artifact's draft as pointing at it does. */
  const pointAt = (id: string, note: string) =>
    act(() =>
      gather(ARTIFACT_DRAFT, {
        id,
        note,
        on: {
          kind: 'canvas',
          canvasId: CANVAS,
          name: 'sign-in-flow',
          title: 'Sign-in flow, take 3',
          version: 3,
          anchor: { kind: 'whole' },
        },
        crop: null,
      }),
    )
  const notes = () => commentsOf(ARTIFACT_DRAFT).map((one) => one.note)

  it('sends a first message with the parts pointed at as it was sent, and keeps one pointed at while it waits for the next', async () => {
    let ready: (started: { id: string; threadId: string }) => void = () => {}
    const startTask = vi.fn(() => new Promise<never>((resolve) => (ready = resolve as never)))
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed), startTask })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    const field = await screen.findByPlaceholderText('Ask about it, or say what to change')
    pointAt('loud', 'Too loud')
    await userEvent.type(field, 'Make it calmer{Enter}')
    // Taken with the words as they went: what is pointed at while they wait is for the next message.
    expect(notes()).toEqual([])
    pointAt('later', 'For later')
    await act(async () => ready({ id: 'task_new', threadId: 'thr_new' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1))
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thr_new', canvasComments: [expect.objectContaining({ body: 'Too loud' })] }),
    )
    expect(notes()).toEqual(['For later'])
  })

  it('gives a first message’s words and parts back to the draft where its chat couldn’t start, beside one pointed at since', async () => {
    let refuse: (why: unknown) => void = () => {}
    const startTask = vi.fn(() => new Promise<never>((_, reject) => (refuse = reject)))
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed), startTask })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'The project’s artifacts' })).getByRole('button', { name: /^Sign-in flow/ }),
    )
    const field = await screen.findByPlaceholderText('Ask about it, or say what to change')
    pointAt('loud', 'Too loud')
    await userEvent.type(field, 'Make it calmer{Enter}')
    pointAt('later', 'For later')
    await act(async () => refuse(new ApiError({ reason: 'Unavailable', message: 'The runtime is busy.' })))
    expect(await screen.findByText(/Couldn’t start its chat/)).toBeTruthy()
    expect(client.send).not.toHaveBeenCalled()
    expect(notes()).toEqual(['Too loud', 'For later'])
    expect((screen.getByPlaceholderText('Ask about it, or say what to change') as HTMLTextAreaElement).value).toBe('Make it calmer')
  })

  it('show as cards, each with its facts and where it is saved, those still being drawn first, narrowed by Filter', async () => {
    const drawn = summary(
      CANVAS,
      'sign-in-flow',
      version(3, { by: { role: 'lead', taskId: 'task_1', taskTitle: 'Redesign sign-in', threadId: 'thr_drew' } }),
      2,
    )
    const saved = {
      ...summary(OTHER, 'plan', version(1, { title: 'The plan', by: { role: 'coordinator', taskId: null, taskTitle: null } })),
      saved: {
        repositoryId: 'repo_1',
        repository: 'kiln',
        path: 'design/plan/',
        how: 'pr' as const,
        follow: true,
        version: 1,
        commit: 'abc1234',
        pullRequest: null,
        state: 'saved' as const,
        problem: null,
      },
    }
    const drawing = { taskId: 'task_new', threadId: 'thr_new', projectId: PROJECT, title: 'Mood board', startedAt: NOW }
    const { client } = canvasClient({
      listCanvases: vi.fn(async () => [drawn, saved]),
      listArtifactsDrawing: vi.fn(async () => [drawing]),
    })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    await userEvent.click(await screen.findByRole('radio', { name: 'Cards' }))
    const cards = await screen.findByRole('list', { name: 'The project’s artifacts' })
    expect(within(cards).getByText('In git at kiln/design/plan/')).toBeTruthy()
    expect(within(cards).getByLabelText('2 open comments')).toBeTruthy()
    expect(within(await within(cards).findByRole('button', { name: /^Mood board/ })).getByText('Drawing the first version')).toBeTruthy()

    // Filter keeps those saved to a repository; the count says how many of all show.
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Saved to a repository' }))
    await userEvent.keyboard('{Escape}')
    expect(within(cards).queryByRole('button', { name: /^Sign-in flow/ })).toBeNull()
    expect(screen.getByText('1 of 3')).toBeTruthy()
  })

  it('opens one asked for beside a conversation, as the view shows and while it shows; Escape goes back to every artifact', async () => {
    const { client } = canvasClient({ listCanvases: vi.fn(async () => listed) })
    askToOpen(PROJECT, CANVAS)
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    expect(await panelOf('Sign-in flow, take 3')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(await screen.findByRole('list', { name: 'The project’s artifacts' })).toBeTruthy()

    act(() => askToOpen(PROJECT, OTHER))
    expect(await screen.findByRole('button', { name: /^The plan/ })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'The project’s artifacts' })).toBeNull()
  })

  it('opens one its own chat is still drawing, by that chat, with the canvas to come', async () => {
    const drawing = { taskId: 'task_new', threadId: 'thr_new', projectId: PROJECT, title: 'Mood board', startedAt: NOW }
    const { client } = canvasClient({
      listCanvases: vi.fn(async () => listed),
      listArtifactsDrawing: vi.fn(async () => [drawing]),
    })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    const cards = await screen.findByRole('list', { name: 'The project’s artifacts' })
    await userEvent.click(await within(cards).findByRole('button', { name: /^Mood board/ }))
    expect(await screen.findByRole('button', { name: /^Mood board/ })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Its chat' })).toBeTruthy()
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(client.startTask).not.toHaveBeenCalled()
  })

  it('shows the picture kept of a page or a canvas of boards on its card, and a drawing of its kind until one is', async () => {
    const page = summary(CANVAS, 'sign-in-flow', version(3, { kind: 'html', entry: 'index.html' }))
    const boards = summary(OTHER, 'plan', version(1, { title: 'The plan', kind: 'boards', entry: 'canvas.json' }))
    const kept = 'data:image/png;base64,iVBORw0KGgo='
    const picture = vi.fn(async (manifest: string) => (manifest === page.latest.manifest ? kept : null))
    const host = fakeHost({
      canvases: { show: vi.fn(), close: vi.fn(), reload: vi.fn(), still: vi.fn(async () => null), cover: vi.fn(async () => {}), picture },
    })
    const { client } = canvasClient({ listCanvases: vi.fn(async () => [page, boards]) })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client, host)
    const cards = await screen.findByRole('list', { name: 'The project’s artifacts' })
    const card = (name: RegExp) => within(cards).getByRole('button', { name })
    await waitFor(() =>
      expect(
        card(/^Sign-in flow/)
          .querySelector('img')
          ?.getAttribute('src'),
      ).toBe(kept),
    )
    expect(picture).toHaveBeenCalledWith(boards.latest.manifest)
    expect(card(/^The plan/).querySelector('img')).toBeNull()
  })

  it('says why the list couldn’t be read', async () => {
    const { client } = canvasClient({
      listCanvases: vi.fn(async () => {
        throw new ApiError({ reason: 'NotFound', message: 'No such project' })
      }),
    })
    withServices(<ArtifactsView projectId={PROJECT} threadId={THREAD} lead={LEAD} />, client)
    expect(await screen.findByText('No such project')).toBeTruthy()
    expect(screen.getByText('No artifacts yet')).toBeTruthy()
  })
})

function CoordinatorScreen() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      room={Room.Both}
      onTask={vi.fn()}
    />
  )
}
function TaskScreen() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}
it.each(['coordinator', 'task'])('opens a canvas from the line and the arriving open in the %s thread', async (screenKind) => {
  const history = [canvasItem('published', 1)]
  const { client } = canvasClient({
    getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [...history] })),
    getThread: vi.fn(async () => snapshot({ items: [...history] })),
  })
  const services = servicesFor(client)
  render(<ServicesProvider value={services}>{screenKind === 'task' ? <TaskScreen /> : <CoordinatorScreen />}</ServicesProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Open Sign-in flow, take 1 beside the conversation' }))
  expect(await panelOf('Sign-in flow, take 1')).toBeTruthy()
  history.push(canvasItem('opened', 2))
  await act(async () => services.cache.refetchQueries({ queryKey: screenKind === 'task' ? keys.thread('th1') : keys.coordinator('p1') }))
  expect(await panelOf('Sign-in flow, take 2')).toBeTruthy()
})
