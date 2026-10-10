import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Picture, type ThreadSnapshot } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { text as outputText } from '../src/renderer/shared/CommandOutput'
import { changed, coordinatorSnapshot, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What an agent hands back, on a task's screen: a command's output in its
 * tool call, streaming while it runs and read once opened after; the turn's
 * screenshots, which open in the lightbox; the document it wrote, read from
 * the worktree, which opens beside the thread; another file's card; and Copy
 * on what it said.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

function Coordinator() {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onTask={vi.fn()} />
}

const session = {
  id: 'sc',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  state: 'active',
  model: null,
  account: null,
  effort: null,
  models: [],
  turnRunning: false,
  context: null,
}

const picture = (digest: string, name: string | null = null): Picture => ({
  digest,
  mediaType: 'image/png',
  bytes: 1201,
  width: 480,
  height: 300,
  name,
  unkept: null,
})

const handing = (overrides: Partial<ThreadSnapshot> = {}) =>
  snapshot({
    items: [
      items.you('Check the page and write it up'),
      items.tool({
        title: 'npm test',
        toolKind: 'execute',
        command: 'npm test',
        status: 'completed',
        output: { kept: true, lines: 2, bytes: 40, dropped: 0, error: null },
        exit: 0,
      }),
      items.tool({
        title: 'npm run lint',
        toolKind: 'execute',
        command: 'npm run lint',
        status: 'failed',
        output: { kept: false, lines: 3, bytes: 60, dropped: 0, error: null },
        exit: 1,
      }),
      items.tool({ title: 'browser_take_screenshot', toolKind: 'other', pictures: [picture('a'.repeat(64), 'before.png')] }),
      items.tool({
        title: 'Write docs/notes.md',
        toolKind: 'edit',
        locations: [{ path: '/w/meridian/docs/notes.md' }],
        files: [{ path: '/w/meridian/docs/notes.md', how: 'wrote', mediaType: null, bytes: null, title: null }],
      }),
      items.hands('Here it is.\n\n| Endpoint | Budget |\n| --- | --: |\n| charges | 600 |', {
        pictures: [picture('b'.repeat(64), 'after.png')],
        files: [{ path: '/w/meridian/report.csv', how: 'linked', mediaType: 'text/csv', bytes: 2048, title: null }],
      }),
    ],
    ...overrides,
  })

describe('what an agent hands back, on a task', () => {
  it('shows a command’s output in its tool call only once opened, its last lines and its end', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => handing()) })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('button', { name: /Worked for/ }))
    expect(client.readOutput).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Ran npm test/ }))
    expect(await screen.findByText(/refunds\/router/)).toBeTruthy()
    expect(client.readOutput).toHaveBeenCalledWith('th1', expect.any(String))
    // What wasn't kept says so; its exit shows on the row, as a failure does.
    await user.click(screen.getByRole('button', { name: /Run npm run lint/ }))
    expect(await screen.findByText(outputText.notKept)).toBeTruthy()
    expect(screen.getByText('exit 1')).toBeTruthy()
  })

  it('shows what a stopped command printed, and what the tool said of it after', async () => {
    const user = userEvent.setup()
    const stopped = snapshot({
      items: [
        items.you('Build it'),
        items.tool({
          title: 'npm run build',
          toolKind: 'execute',
          command: 'npm run build',
          status: 'failed',
          output: { kept: true, lines: 2, bytes: 30, dropped: 0, error: 'Tool execution aborted' },
          exit: null,
        }),
      ],
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => stopped),
      readOutput: vi.fn(async () => ({ text: 'compiling\nwarning: unused import\n', dropped: 0 })),
    })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('button', { name: /Worked for/ }))
    await user.click(screen.getByRole('button', { name: /Run npm run build/ }))
    expect(await screen.findByText('warning: unused import')).toBeTruthy()
    expect(screen.getByText('Tool execution aborted')).toBeTruthy()
  })

  it('says why what a command printed couldn’t be read', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({
      getThread: vi.fn(async () => handing()),
      readOutput: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: "That output isn't there any more." }))),
    })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('button', { name: /Worked for/ }))
    await user.click(screen.getByRole('button', { name: /Ran npm test/ }))
    expect(await screen.findByText("That output isn't there any more.")).toBeTruthy()
  })

  it('streams a running command’s output into its tool call, open, as it comes', async () => {
    const run = items.tool({ title: 'npm test', toolKind: 'execute', command: 'npm test', status: 'in_progress' })
    const base = snapshot({ items: [items.you('Run it'), run] })
    const live = { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => live) })
    withServices(<Task />, client)
    await screen.findByRole('button', { name: /Working for/ })
    await userEvent.click(screen.getByRole('button', { name: /Working for/ }))
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: ' ✓ charges/limit (14)\n ⋯ webhooks', dropped: 0 }))
    expect(await screen.findByText(/charges\/limit/)).toBeTruthy()
    expect(screen.getByText(/⋯ webhooks/)).toBeTruthy()
    // Another thread's output isn't this one's.
    act(() => emit({ _tag: 'Output', threadId: 'th2', itemId: run.id, text: 'elsewhere', dropped: 0 }))
    expect(screen.queryByText('elsewhere')).toBeNull()
  })

  it('reads what a running command printed before the window looked, until more streams in', async () => {
    const run = items.tool({ title: 'npm run dev', toolKind: 'execute', command: 'npm run dev', status: 'in_progress' })
    const base = snapshot({ items: [items.you('Start it'), run] })
    const live = { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => live),
      readOutput: vi.fn(async () => ({ text: 'ready in 12 ms\n', dropped: 0 })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Working for/ }))
    expect(await screen.findByText(/ready in 12 ms/)).toBeTruthy()
    expect(client.readOutput).toHaveBeenCalledWith('th1', run.id)
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: 'ready in 12 ms\nlistening on 4000\n', dropped: 0 }))
    expect(await screen.findByText(/listening on 4000/)).toBeTruthy()
  })

  it('reads a running command’s output again whenever the watch starts again, though it had heard some', async () => {
    const run = items.tool({ title: 'npm run dev', toolKind: 'execute', command: 'npm run dev', status: 'in_progress' })
    const base = snapshot({ items: [items.you('Start it'), run] })
    const live = { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
    const readOutput = vi.fn().mockResolvedValue({ text: 'ready\n', dropped: 0 })
    const { client, emit, rewatch } = fakeClient({ getThread: vi.fn(async () => live), readOutput })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Working for/ }))
    expect(await screen.findByText(/^ready$/)).toBeTruthy()
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: 'ready\ncompiled\n', dropped: 0 }))
    expect(await screen.findByText(/^compiled$/)).toBeTruthy()
    // The watch broke while it printed more, then went quiet: listening again, it reads what it missed.
    readOutput.mockResolvedValue({ text: 'ready\ncompiled\nlistening on 4000\n', dropped: 0 })
    act(() => rewatch())
    expect(await screen.findByText(/^listening on 4000$/)).toBeTruthy()
  })

  it('keeps what it heard over a read that began before it', async () => {
    const run = items.tool({ title: 'npm run dev', toolKind: 'execute', command: 'npm run dev', status: 'in_progress' })
    const base = snapshot({ items: [items.you('Start it'), run] })
    const live = { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
    let answer: (value: { text: string; dropped: number }) => void = () => {}
    const readOutput = vi.fn(() => new Promise<{ text: string; dropped: number }>((resolve) => (answer = resolve)))
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => live), readOutput })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Working for/ }))
    await waitFor(() => expect(readOutput).toHaveBeenCalled())
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: 'older\nnewer\n', dropped: 0 }))
    expect(await screen.findByText(/^newer$/)).toBeTruthy()
    // The read answers late, with less: what was heard after it began stands.
    await act(async () => answer({ text: 'older\n', dropped: 0 }))
    expect(screen.getByText(/^newer$/)).toBeTruthy()
  })

  it('opens the turn’s screenshots in the lightbox, the arrows moving between them, and focus coming back', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => handing()) })
    withServices(<Task />, client)
    const shots = await screen.findByRole('list', { name: 'Screenshots' })
    const before = within(shots).getByRole('img', { name: 'before.png' })
    expect(before.getAttribute('src')).toBe(`althar-picture://shot/${'a'.repeat(64)}?w=1120`)
    const open = within(shots).getByRole('button', { name: 'View before.png full size' })
    await user.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'before.png' })
    expect(within(dialog).getByRole('img', { name: 'before.png' }).getAttribute('src')).toBe(`althar-picture://shot/${'a'.repeat(64)}`)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'after.png' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(open))
  })

  it('reads the document the lead wrote from its worktree, and opens it beside the thread', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => handing()) })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText(/Refunds share the partner budget/)).toBeTruthy()
    expect(client.readDocument).toHaveBeenCalledWith('th1', '/w/meridian/docs/notes.md')
    await user.click(within(card).getByRole('button', { name: 'Open in editor' }))
    expect(client.openInEditor).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/w/meridian/docs/notes.md' }))
    await user.click(within(card).getByRole('button', { name: 'Read in the panel' }))
    const panel = await screen.findByRole('complementary', { name: 'notes.md' })
    expect(within(panel).getByText('docs/notes.md')).toBeTruthy()
    // It opens in the editor files open in, at the file.
    await user.click(within(panel).getByRole('button', { name: 'Open in editor' }))
    expect(client.openInEditor).toHaveBeenCalledWith(expect.objectContaining({ path: '/w/meridian/docs/notes.md' }))
    await user.click(within(panel).getByRole('button', { name: /Close the panel/ }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'notes.md' })).toBeNull())
  })

  it('reads a document by the whole path it was written at, in the card and the panel, and opens that one in the editor', async () => {
    const user = userEvent.setup()
    // A task of two repositories: the lead wrote the first one's docs/notes.md; the second has one too.
    const two = handing({
      task: { ...handing().task, worktree: '/t/meridian/task/api' },
      items: [
        items.you('Write it up'),
        items.tool({
          title: 'Write docs/notes.md',
          toolKind: 'edit',
          locations: [{ path: '/t/meridian/task/api/docs/notes.md' }],
          files: [{ path: '/t/meridian/task/api/docs/notes.md', how: 'wrote', mediaType: null, bytes: null, title: null }],
        }),
        items.says('Done.'),
      ],
    })
    const readDocument = vi.fn(async (_threadId: string, path: string) =>
      path === '/t/meridian/task/api/docs/notes.md'
        ? { path, body: '# The api’s notes\n', bytes: 18, lines: 1 }
        : { path, body: '# The web’s notes\n', bytes: 18, lines: 1 },
    )
    const { client } = fakeClient({ getThread: vi.fn(async () => two), readDocument })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText('The api’s notes')).toBeTruthy()
    expect(readDocument.mock.calls.map(([, path]) => path)).toEqual(['/t/meridian/task/api/docs/notes.md'])
    // The panel reads it by the same path, again as it opens.
    await user.click(within(card).getByRole('button', { name: 'Read in the panel' }))
    const panel = await screen.findByRole('complementary', { name: 'notes.md' })
    expect(within(panel).getByText('The api’s notes')).toBeTruthy()
    expect(new Set(readDocument.mock.calls.map(([, path]) => path))).toEqual(new Set(['/t/meridian/task/api/docs/notes.md']))
    await user.click(within(panel).getByRole('button', { name: 'Open in editor' }))
    expect(client.openInEditor).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/t/meridian/task/api/docs/notes.md' }))
  })

  it('reads its documents again when a command ends, which may have rewritten one without naming it', async () => {
    const readDocument = vi
      .fn()
      .mockResolvedValueOnce({ path: '/w/meridian/docs/notes.md', body: '# Notes\n\nFirst.\n', bytes: 16, lines: 3 })
      .mockResolvedValue({ path: '/w/meridian/docs/notes.md', body: '# Notes\n\nRewritten by a script.\n', bytes: 30, lines: 3 })
    // A script rewrites the document: the command says no file it touched.
    const script = {
      ...items.tool({ title: 'python3 tidy.py', toolKind: 'execute', command: 'python3 tidy.py', status: 'completed' }),
      id: 'i-script',
      sequence: 1_000,
    }
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => handing()), readDocument, getThreadItem: vi.fn(async () => script) })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText('First.')).toBeTruthy()
    act(() => emit(changed('thread_item', 'i-script')))
    expect(await within(card).findByText('Rewritten by a script.')).toBeTruthy()
    expect(readDocument).toHaveBeenCalledTimes(2)
  })

  it('reads a document again as its panel opens', async () => {
    const user = userEvent.setup()
    const readDocument = vi
      .fn()
      .mockResolvedValueOnce({ path: '/w/meridian/docs/notes.md', body: '# Notes\n\nFirst.\n', bytes: 16, lines: 3 })
      .mockResolvedValue({ path: '/w/meridian/docs/notes.md', body: '# Notes\n\nAs it is now.\n', bytes: 22, lines: 3 })
    const { client } = fakeClient({ getThread: vi.fn(async () => handing()), readDocument })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText('First.')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Read in the panel' }))
    const panel = await screen.findByRole('complementary', { name: 'notes.md' })
    expect(await within(panel).findByText('As it is now.')).toBeTruthy()
    expect(readDocument).toHaveBeenCalledTimes(2)
  })

  it('says a document couldn’t be read, in the card', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => handing()),
      readDocument: vi.fn(async () =>
        Promise.reject(
          new ApiError({ reason: 'DocumentRefused', message: 'This document is too large to show here. Open it in your editor.' }),
        ),
      ),
    })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText(/too large to show here/)).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Read in the panel' })).toBeNull()
  })

  it('cards another file it pointed at, and draws the table in what it said, which Copy takes', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => handing()) })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'report.csv' })
    expect(within(card).getByText(/CSV · 2 KB/)).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Open in editor' }))
    expect(client.openInEditor).toHaveBeenCalledWith(expect.objectContaining({ path: '/w/meridian/report.csv' }))
    expect(screen.getByRole('columnheader', { name: 'Budget' })).toBeTruthy()
    // The document's card copies its markdown; the turn's own Copy, after it, what the turn said.
    const turn = screen.getAllByRole('article').find((article) => article.textContent?.includes('Here it is.'))
    expect(within(turn ?? document.body).getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
  })
})

describe('what an agent hands back, elsewhere', () => {
  it('in the coordinator’s thread: a command streams, and a picture opens in the lightbox, with no panel to open documents in', async () => {
    const user = userEvent.setup()
    const run = items.tool({ title: 'git log', toolKind: 'execute', command: 'git log', status: 'in_progress' })
    const live = coordinatorSnapshot({
      session: { ...session, turnRunning: true },
      items: [
        items.you('What changed lately?'),
        items.hands('Here is the page.', {
          pictures: [picture('c'.repeat(64), 'page.png')],
          files: [{ path: '/w/meridian/docs/history.md', how: 'linked', mediaType: 'text/markdown', bytes: null, title: null }],
        }),
        run,
      ],
    })
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => live) })
    withServices(<Coordinator />, client)
    await user.click(await screen.findByRole('button', { name: /Working for/ }))
    act(() => emit({ _tag: 'Output', threadId: 'thc', itemId: run.id, text: 'a1b2c3 Add a retry\n', dropped: 0 }))
    expect(await screen.findByText(/a1b2c3 Add a retry/)).toBeTruthy()
    act(() => emit({ _tag: 'Output', threadId: 'other', itemId: run.id, text: 'elsewhere', dropped: 0 }))
    expect(screen.queryByText('elsewhere')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View page.png full size' }))
    expect(await screen.findByRole('dialog', { name: 'page.png' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The coordinator writes no documents, so its card has no panel to open in, and no editor.
    const card = await screen.findByRole('article', { name: 'history.md' })
    expect(within(card).queryByRole('button', { name: 'Read in the panel' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Open in editor' })).toBeNull()
  })

  it('without an editor on this Mac, a document opens beside the thread with nothing to open it in, and follows its edits', async () => {
    const user = userEvent.setup()
    const readDocument = vi
      .fn()
      .mockResolvedValueOnce({ path: 'docs/notes.md', body: '# Notes\n\nFirst.\n', bytes: 16, lines: 3 })
      .mockRejectedValue(new ApiError({ reason: 'NotFound', message: "That document isn't there any more." }))
    const edit = {
      ...items.tool({ title: 'Delete docs/notes.md', toolKind: 'delete', locations: [{ path: '/w/meridian/docs/notes.md' }] }),
      id: 'i-edit',
      sequence: 1_000,
    }
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => handing()),
      listEditors: vi.fn(async () => []),
      readDocument,
      getThreadItem: vi.fn(async () => edit),
    })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(await within(card).findByText('First.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Open in editor' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Read in the panel' }))
    const panel = await screen.findByRole('complementary', { name: 'notes.md' })
    expect(within(panel).queryByRole('button', { name: 'Open in editor' })).toBeNull()
    // The lead touches it again: the panel reads it again, and says it has gone.
    act(() => emit(changed('thread_item', 'i-edit')))
    expect(await within(panel).findByText("That document isn't there any more.")).toBeTruthy()
    // A file outside the worktree has no editor to open in either.
    expect(within(screen.getByRole('article', { name: 'report.csv' })).queryByRole('button', { name: 'Open in editor' })).toBeNull()
  })

  it('names a document outside the worktree whole, and opens it in no editor', async () => {
    const user = userEvent.setup()
    const outside = snapshot({
      items: [
        items.you('Write it up'),
        items.hands('Written.', {
          files: [{ path: '/elsewhere/notes.md', how: 'linked', mediaType: 'text/markdown', bytes: null, title: null }],
        }),
      ],
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => outside) })
    withServices(<Task />, client)
    const card = await screen.findByRole('article', { name: 'notes.md' })
    expect(within(card).getByText(/\/elsewhere\//)).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Open in editor' })).toBeNull()
    await user.click(await within(card).findByRole('button', { name: 'Read in the panel' }))
    const panel = await screen.findByRole('complementary', { name: 'notes.md' })
    expect(within(panel).queryByRole('button', { name: 'Open in editor' })).toBeNull()
  })
})
