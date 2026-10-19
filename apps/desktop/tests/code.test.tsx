import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CodeFound } from '@althar/contracts'
import { DocPanel, Markdown, ThreadShellProvider } from '@althar/ui'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { whereOf } from '../src/renderer/shared/code/CodeHost'
import { useThreadHost } from '../src/renderer/shared/ThreadHost'
import { fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

const retry: CodeFound = {
  kind: 'file',
  name: 'src/retry.ts:2',
  path: 'src/retry.ts',
  line: 2,
  byName: false,
  bytes: 40,
  lines: 3,
  content: 'text',
  changed: { add: 3, del: 0 },
  since: null,
}

const runs: CodeFound = { ...retry, name: 'Runs.ts', path: 'src/runs/Runs.ts', byName: true, changed: null }

/** What the runtime finds: the two files above, by name, and nothing else. */
const finding = () =>
  vi.fn(async (_threadId: string, messages: ReadonlyArray<{ readonly names: ReadonlyArray<string> }>) => ({
    place: { kind: 'task' as const, repositories: [{ slug: 'meridian', name: 'meridian', branch: 'althar/add-a-retry' }] },
    messages: messages.map((message) => ({ found: [retry, runs].filter((one) => message.names.includes(one.name)) })),
  }))

const reading = () =>
  vi.fn(async (_threadId: string, path: string) => ({
    path,
    text: 'export function retry() {\n  return 3\n}\n',
    from: 1,
    total: 3,
    cut: false,
  }))

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

describe('the code a lead names, on a task’s screen', () => {
  it('opens a file a message names beside the thread, at its lines, and in the editor from there', async () => {
    const said = items.says('The retry is in `src/retry.ts:2`; `Runs.ts` calls it. Run `npm test`.')
    const findCode = finding()
    const readCode = reading()
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [items.you('Add a retry'), said] })),
      findCode,
      readCode,
    })
    withServices(<Task />, client)

    const chip = await screen.findByRole('button', { name: 'Open src/retry.ts:2' })
    // Each message asks once, by the item it is, for its names that may be code.
    expect(findCode).toHaveBeenCalledWith('th1', [{ itemId: said.id, names: ['src/retry.ts:2', 'Runs.ts'] }])
    expect(screen.getByText('npm test').tagName).toBe('CODE')

    await userEvent.click(chip)
    const panel = await screen.findByRole('complementary', { name: 'retry.ts' })
    await waitFor(() => expect(panel.textContent).toContain('return 3'))
    expect(readCode).toHaveBeenCalledWith('th1', 'src/retry.ts', { line: 2 })
    expect(within(panel).getByText('althar/add-a-retry')).toBeTruthy()
    expect(chip.hasAttribute('data-open')).toBe(true)

    await userEvent.click(within(panel).getByRole('button', { name: 'Open in Zed' }))
    expect(client.openCode).toHaveBeenCalledWith({ threadId: 'th1', editor: 'zed', path: 'src/retry.ts', line: 2 })
    // What the task changed in it, from git.
    await userEvent.click(within(panel).getByRole('radio', { name: /Change \+3 −0/ }))
    await waitFor(() => expect(client.getFileDiff).toHaveBeenCalledWith('t1', 'src/retry.ts'))
  })

  it('steps to the thread’s next name with ⌥↓, and closes the one open with a press on it', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        snapshot({ items: [items.you('Where?'), items.says('In `src/retry.ts:2`.'), items.you('And?'), items.says('And `Runs.ts`.')] }),
      ),
      findCode: finding(),
      readCode: reading(),
    })
    withServices(<Task />, client)
    const chip = await screen.findByRole('button', { name: 'Open src/retry.ts:2' })
    await screen.findByRole('button', { name: 'Open src/runs/Runs.ts:2' })
    await userEvent.click(chip)
    expect(await screen.findByRole('complementary', { name: 'retry.ts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'The next reference' })).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true })
    expect(await screen.findByRole('complementary', { name: 'Runs.ts' })).toBeTruthy()
    // And back, from the panel's own step.
    await userEvent.click(screen.getByRole('button', { name: 'The reference before' }))
    expect(await screen.findByRole('complementary', { name: 'retry.ts' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true })
    expect(await screen.findByRole('complementary', { name: 'Runs.ts' })).toBeTruthy()
    // Typing, ⌥↓ is the field's.
    const field = screen.getByRole('textbox')
    fireEvent.keyDown(field, { key: 'ArrowUp', altKey: true })
    expect(screen.getByRole('complementary', { name: 'Runs.ts' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Open src/runs/Runs.ts:2' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })

  it('opens and steps to the same name in two messages where each names another file', async () => {
    const first = items.says('In `apps/desktop/src/`, `model.ts` keeps it.')
    const second = items.says('And in `packages/ui/src/`, `model.ts` draws it.')
    const inDesktop: CodeFound = { ...runs, name: 'model.ts', path: 'apps/desktop/src/model.ts' }
    const inKit: CodeFound = { ...inDesktop, path: 'packages/ui/src/model.ts' }
    const readCode = reading()
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [items.you('Where?'), first, items.you('And?'), second] })),
      // Each message's folder tells its model.ts apart.
      findCode: vi.fn(async (_threadId: string, messages: ReadonlyArray<{ readonly itemId?: string }>) => ({
        place: { kind: 'task' as const, repositories: [{ slug: 'meridian', name: 'meridian', branch: 'althar/add-a-retry' }] },
        messages: messages.map((message) => ({ found: [message.itemId === first.id ? inDesktop : inKit] })),
      })),
      readCode,
    })
    withServices(<Task />, client)
    const desktop = await screen.findByRole('button', { name: 'Open apps/desktop/src/model.ts:2' })
    const kit = await screen.findByRole('button', { name: 'Open packages/ui/src/model.ts:2' })

    await userEvent.click(desktop)
    await screen.findByRole('complementary', { name: 'model.ts' })
    expect(desktop.hasAttribute('data-open')).toBe(true)
    expect(kit.hasAttribute('data-open')).toBe(false)
    // The other one opens in its place, rather than closing the one open.
    await userEvent.click(kit)
    await waitFor(() => expect(readCode).toHaveBeenCalledWith('th1', 'packages/ui/src/model.ts', { line: 2 }))
    expect(screen.getByRole('complementary', { name: 'model.ts' })).toBeTruthy()
    expect(kit.hasAttribute('data-open')).toBe(true)
    expect(desktop.hasAttribute('data-open')).toBe(false)
    // And ⌥↑ steps back to the first, rather than past it as the same name.
    fireEvent.keyDown(document.body, { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(desktop.hasAttribute('data-open')).toBe(true))
    expect(screen.getByRole('complementary', { name: 'model.ts' })).toBeTruthy()
  })

  it('⌘-press on a name opens it in the editor, without opening it beside', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [items.says('In `src/retry.ts:2`.')] })),
      findCode: finding(),
      readCode: reading(),
    })
    withServices(<Task />, client)
    fireEvent.click(await screen.findByRole('button', { name: 'Open src/retry.ts:2' }), { metaKey: true })
    await waitFor(() => expect(client.openCode).toHaveBeenCalledWith({ threadId: 'th1', editor: 'zed', path: 'src/retry.ts', line: 2 }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

/** A thread's host as a screen uses it: a message, a document it opens, and the workbench they open on. */
function Host() {
  const host = useThreadHost(true, { threadId: 'th1', taskId: 't1' })
  return (
    <ThreadShellProvider value={host.shell}>
      <button type="button" onClick={() => host.shell.openDoc?.({ path: 'docs/plan.md', body: 'The plan: `src/retry.ts:2`.' })}>
        Read the plan
      </button>
      <Markdown source="It is `src/retry.ts:2`." />
      {host.workbench(host.doc && <DocPanel doc={host.doc} onClose={host.closeDoc} />)}
    </ThreadShellProvider>
  )
}

describe('the conversation’s workbench', () => {
  it('opens a file from the lead’s document on top of it, with Back, and one from the thread in its place', async () => {
    const { client } = fakeClient({ findCode: finding(), readCode: reading() })
    withServices(<Host />, client)
    await userEvent.click(screen.getByRole('button', { name: 'Read the plan' }))
    const doc = await screen.findByRole('complementary', { name: 'plan.md' })
    await userEvent.click(await within(doc).findByRole('button', { name: 'Open src/retry.ts:2' }))
    const file = await screen.findByRole('complementary', { name: 'retry.ts' })
    expect(doc.closest('[hidden]')).not.toBeNull()

    await userEvent.click(within(file).getByRole('button', { name: 'Back to the document' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'retry.ts' })).toBeNull())
    expect(doc.closest('[hidden]')).toBeNull()

    // From the document again, then Close: both go.
    await userEvent.click(within(doc).getByRole('button', { name: 'Open src/retry.ts:2' }))
    await userEvent.click(
      within(await screen.findByRole('complementary', { name: 'retry.ts' })).getByRole('button', { name: 'Close the panel' }),
    )
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())

    // From the thread, with the document open: the file takes its place.
    await userEvent.click(screen.getByRole('button', { name: 'Read the plan' }))
    await screen.findByRole('complementary', { name: 'plan.md' })
    const inThread = screen
      .getAllByRole('button', { name: 'Open src/retry.ts:2' })
      .find((chip) => chip.closest('[data-workbench]') === null)
    await userEvent.click(inThread ?? document.body)
    await screen.findByRole('complementary', { name: 'retry.ts' })
    expect(screen.queryByRole('complementary', { name: 'plan.md' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to the document' })).toBeNull()
  })

  it('is dragged wider by its edge, and keeps the width', async () => {
    const { client } = fakeClient({ findCode: finding(), readCode: reading() })
    withServices(<Host />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Open src/retry.ts:2' }))
    const edge = await screen.findByRole('separator', { name: 'Width of the panel' })
    const was = Number(edge.getAttribute('aria-valuenow'))
    edge.focus()
    fireEvent.keyDown(edge, { key: 'ArrowLeft' })
    expect(Number(edge.getAttribute('aria-valuenow'))).toBe(was + 16)
    expect(window.localStorage.getItem('althar.bench')).toBe(String(was + 16))
  })
})

/** The coordinator's thread, as its screen hosts it: a message naming a line of a long file, put far down it since. */
function Coordinator() {
  const host = useThreadHost(false, { threadId: 'th1', taskId: null })
  return (
    <ThreadShellProvider value={host.shell}>
      <Markdown source="It waits at `src/runs/Runs.ts:10000`." />
      {host.workbench(null)}
    </ThreadShellProvider>
  )
}

describe('a long file the coordinator named', () => {
  it('reads it around the line as it is now, and as it was when said around the line it named', async () => {
    const moved: CodeFound = {
      ...runs,
      name: 'src/runs/Runs.ts:10000',
      line: 10000,
      lines: 12_000,
      byName: false,
      since: { commit: 'abc1234', said: '2026-10-18T16:40:00.000Z', now: { line: 11_000 } },
    }
    const readCode = vi.fn(async (_threadId: string, path: string) => ({
      path,
      text: '// a line\n',
      from: 10_990,
      total: 12_000,
      cut: true,
    }))
    const { client } = fakeClient({
      findCode: vi.fn(async (_threadId: string, messages: ReadonlyArray<unknown>) => ({
        place: { kind: 'default' as const, repositories: [{ slug: 'meridian', name: 'meridian', branch: 'main' }] },
        messages: messages.map(() => ({ found: [moved] })),
      })),
      readCode,
    })
    withServices(<Coordinator />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Open src/runs/Runs.ts:10000' }))
    const panel = await screen.findByRole('complementary', { name: 'Runs.ts' })
    await waitFor(() => expect(readCode).toHaveBeenCalledWith('th1', 'src/runs/Runs.ts', { line: 11_000 }))
    await userEvent.click(within(panel).getByRole('radio', { name: 'When said' }))
    await waitFor(() => expect(readCode).toHaveBeenCalledWith('th1', 'src/runs/Runs.ts', { commit: 'abc1234', line: 10_000 }))
  })
})

describe('where a file was read from', () => {
  it('says the branch of the repository its path is in, and when it was said', () => {
    const place = {
      kind: 'default' as const,
      repositories: [
        { slug: 'api', name: 'API', branch: 'main' },
        { slug: 'web', name: 'Web', branch: 'trunk' },
      ],
    }
    const said = new Date(Date.now() - 2 * 3600_000).toISOString()
    expect(whereOf(place, { ...retry, path: 'web/src/a.ts', since: { commit: 'abc1234', said, now: { line: 4 } } })).toEqual({
      kind: 'default',
      branch: 'trunk',
      said: '2h ago',
    })
    expect(whereOf(undefined, retry)).toBeUndefined()
  })
})
